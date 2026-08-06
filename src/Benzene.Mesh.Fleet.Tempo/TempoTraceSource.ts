/** Port of Benzene.Mesh.Fleet.Tempo.TempoTraceSource. */
import {
  CorrelationView,
  IMeshTraceSource,
  MeshTimeRange,
  MeshTimeRangeResolver,
  TraceSummary,
  TraceView,
} from '@benzene/mesh-collector';
import { MeshTraceEvent } from '@benzene/mesh-wire';
import { TempoTraceMapper } from './TempoTraceMapper';
import { TempoTraceSourceOptions } from './TempoTraceSourceOptions';

/** A `fetch`-like function - the port of C# `HttpClient` (`HttpClient` -> injectable `fetch`). */
export type TempoFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** A resolved absolute search window, in epoch milliseconds. */
interface SearchWindow {
  start: number;
  end: number;
}

/** One search-summary row from Tempo's `/api/search` `traces[]`. */
interface TempoTraceMatch {
  traceId: string;
  startedAt: number;
  durationMs: number;
  rootServiceName?: string;
}

type JsonObject = Record<string, unknown>;

/**
 * An {@link IMeshTraceSource} that answers the fleet's trace read-models from Grafana Tempo's HTTP trace
 * API: a trace by id (`GET /api/traces/{id}`), a correlation-id search + group (`GET /api/search` with
 * TraceQL), and the recent-flows list (an unfiltered-by-id TraceQL search). The non-AWS reference
 * realisation of the trace-backed fleet reader scoped in `work/otel-fleet-adapter-scope.md` - it reuses the
 * same `CompositeMeshFleetReadModel`, handlers, and UI as the X-Ray/Jaeger adapters, differing only in the
 * backend it reads.
 *
 * Unlike the topology adapter (`@benzene/mesh-tracing-tempo`, which queries Tempo's metrics-generator via
 * PromQL), this reads Tempo's *trace* API directly. Trace stats and service health are deliberately not
 * sourced here (see {@link IMeshTraceSource}): traces are sampled and Tempo has no heartbeat feed. Following
 * the topology adapter's philosophy, a reachable-but-unsuccessful response (HTTP error, or an
 * unexpected/empty body) surfaces as undefined/empty rather than throwing; a genuine connection failure (the
 * `fetch` rejecting) still throws (and the composite's fetch-isolation degrades that slice).
 *
 * `HttpClient` -> injectable `fetch` (mirroring `@benzene/mesh-tracing-tempo`'s query client); the body is
 * read on any `response.ok`, like `GetAsync` + `ReadAsStringAsync`. `CancellationToken` -> optional
 * `AbortSignal`; `DateTimeOffset` -> epoch-ms `number` (search params are epoch **seconds**, as Tempo's
 * `/api/search` expects, matching the C# `ToUnixTimeSeconds()`).
 */
export class TempoTraceSource implements IMeshTraceSource {
  /**
   * Creates the source over a `fetch`-like function and Tempo endpoint/window options.
   * @param fetchFn The injectable `fetch` (defaults to the global `fetch`) - the port of C# `HttpClient`.
   * @param options Where and over what windows to query Tempo's trace API.
   */
  constructor(
    private readonly fetchFn: TempoFetch = fetch,
    private readonly options: TempoTraceSourceOptions,
  ) {}

  async getTraceAsync(traceId: string, cancellationToken?: AbortSignal): Promise<TraceView | undefined> {
    if (traceId.length === 0) {
      return undefined;
    }

    const events = await this.fetchTraceEvents(traceId, cancellationToken);
    // Undefined (not empty) when Tempo has no such trace, or a real trace carried no Benzene topic-bearing
    // span - so the query handler answers NotFound, not an empty waterfall.
    if (events.length === 0) {
      return undefined;
    }

    const view = new TraceView();
    view.traceId = traceId;
    view.events = events;
    return view;
  }

  async getCorrelationAsync(
    correlationId: string,
    range?: MeshTimeRange,
    cancellationToken?: AbortSignal,
  ): Promise<CorrelationView | undefined> {
    if (correlationId.length === 0) {
      return undefined;
    }

    // Attribute names carry dots and a hyphen, so quote the name in TraceQL.
    const traceQl = `{ span."benzene.correlation-id" = "${escape(correlationId)}" }`;
    const window = this.resolveWindow(range, this.options.correlationLookbackMs);
    const matches = await this.search(traceQl, window, 100, cancellationToken);
    if (matches.length === 0) {
      return undefined;
    }

    const traces: TraceView[] = [];
    for (const match of matches) {
      const events = await this.fetchTraceEvents(match.traceId, cancellationToken);
      if (events.length > 0) {
        const view = new TraceView();
        view.traceId = match.traceId;
        view.events = events;
        traces.push(view);
      }
    }

    if (traces.length === 0) {
      return undefined;
    }

    // Earliest-first, the same ordering the in-memory collector and the X-Ray adapter use so the UI renders
    // every plane's correlation view identically.
    traces.sort((a, b) => earliestStart(a) - earliestStart(b));

    const result = new CorrelationView();
    result.correlationId = correlationId;
    result.traces = traces;
    return result;
  }

  async getRecentFlowsAsync(
    limit = 20,
    range?: MeshTimeRange,
    cancellationToken?: AbortSignal,
  ): Promise<readonly TraceSummary[]> {
    if (limit <= 0) {
      return [];
    }

    // Any trace carrying a Benzene topic is a mesh flow; this filters out non-mesh traces the same way the
    // span->event mapper does, so the fleet's recent-flows list is mesh flows only.
    const window = this.resolveWindow(range, this.options.recentFlowsLookbackMs);
    const matches = await this.search('{ span."benzene.topic" != "" }', window, limit, cancellationToken);

    return matches
      .map((m) => {
        const summary = new TraceSummary();
        summary.traceId = m.traceId;
        summary.durationMs = m.durationMs;
        summary.startedAt = m.startedAt;
        summary.services =
          m.rootServiceName === undefined || m.rootServiceName.length === 0 ? [] : [m.rootServiceName];
        // Tempo's search summary carries no aggregate error flag and no span count; the failure colouring
        // and accurate event count come from the drill-in trace (getTraceAsync).
        summary.failed = false;
        summary.events = 0;
        return summary;
      })
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  private async fetchTraceEvents(traceId: string, cancellationToken?: AbortSignal): Promise<MeshTraceEvent[]> {
    const body = await this.getStringOrNull(
      `${this.options.tempoUrl}/api/traces/${encodeURIComponent(traceId)}`,
      cancellationToken,
    );
    return body === undefined ? [] : TempoTraceMapper.map(traceId, body);
  }

  private async search(
    traceQl: string,
    window: SearchWindow,
    limit: number,
    cancellationToken?: AbortSignal,
  ): Promise<TempoTraceMatch[]> {
    const start = Math.floor(window.start / 1000);
    const end = Math.floor(window.end / 1000);
    const url =
      `${this.options.tempoUrl}/api/search?q=${encodeURIComponent(traceQl)}` +
      `&start=${start}&end=${end}&limit=${limit}`;

    const body = await this.getStringOrNull(url, cancellationToken);
    return body === undefined ? [] : parseSearch(body);
  }

  /**
   * Resolve a requested {@link MeshTimeRange} to Tempo's search `[start,end]`, falling back to
   * `now - fallbackMs` .. `now` when no window was requested (today's behavior). Tempo's `/api/search` needs
   * a bounded range either way.
   */
  private resolveWindow(range: MeshTimeRange | undefined, fallbackMs: number): SearchWindow {
    const resolved = MeshTimeRangeResolver.resolve(range, Date.now());
    if (resolved !== undefined) {
      return { start: resolved.from, end: resolved.to };
    }

    const end = Date.now();
    return { start: end - fallbackMs, end };
  }

  /**
   * GET a URL, returning the body on success or `undefined` on any reachable-but-unsuccessful response - the
   * topology adapter's "one bad query shouldn't fault the build" rule. A connection-level failure (the
   * `fetch` rejecting) still throws (the composite's fetch-isolation catches it).
   */
  private async getStringOrNull(url: string, cancellationToken?: AbortSignal): Promise<string | undefined> {
    const response = await this.fetchFn(url, cancellationToken !== undefined ? { signal: cancellationToken } : undefined);
    return response.ok ? await response.text() : undefined;
  }
}

function parseSearch(body: string): TempoTraceMatch[] {
  const matches: TempoTraceMatch[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return matches;
  }

  if (!isObject(parsed) || !isArray(parsed.traces)) {
    return matches;
  }

  for (const trace of parsed.traces) {
    if (!isObject(trace)) {
      continue;
    }

    const traceId = getString(trace, 'traceID') ?? getString(trace, 'traceId');
    if (traceId === undefined || traceId.length === 0) {
      continue;
    }

    matches.push({
      traceId,
      startedAt: nanosToTime(getString(trace, 'startTimeUnixNano')),
      durationMs: getDouble(trace, 'durationMs'),
      rootServiceName: getString(trace, 'rootServiceName'),
    });
  }

  return matches;
}

function earliestStart(trace: TraceView): number {
  return trace.events.length === 0 ? Number.MAX_SAFE_INTEGER : Math.min(...trace.events.map((e) => e.startedAt));
}

// TraceQL string literals are double-quoted; escape backslashes and quotes so a value can't break out.
function escape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// unix-nano values exceed Number.MAX_SAFE_INTEGER, so parse as bigint to keep C#'s `long` precision.
function nanosToTime(nanos: string | undefined): number {
  if (nanos === undefined || !/^[+-]?\d+$/.test(nanos.trim())) {
    return 0;
  }
  let value: bigint;
  try {
    value = BigInt(nanos.trim());
  } catch {
    return 0;
  }
  return value > 0n ? Number(value / 1_000_000n) : 0;
}

function getString(node: JsonObject, name: string): string | undefined {
  const value = node[name];
  return typeof value === 'string' ? value : undefined;
}

function getDouble(node: JsonObject, name: string): number {
  const value = node[name];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && value.trim().length > 0) {
      return parsed;
    }
  }

  return 0;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

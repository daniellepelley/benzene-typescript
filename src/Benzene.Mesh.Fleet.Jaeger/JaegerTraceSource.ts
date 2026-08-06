/** Port of Benzene.Mesh.Fleet.Jaeger.JaegerTraceSource. */
import {
  CorrelationView,
  IMeshTraceSource,
  MeshTimeRange,
  MeshTimeRangeResolver,
  TraceSummary,
  TraceView,
} from '@benzene/mesh-collector';
import { BenzeneResultStatus } from '@benzene/results';
import { JaegerMappedTrace, JaegerTraceMapper } from './JaegerTraceMapper';
import { JaegerTraceSourceOptions } from './JaegerTraceSourceOptions';

/** A `fetch`-like function - the port of C# `HttpClient` (`HttpClient` -> injectable `fetch`). */
export type JaegerFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** A resolved absolute search window, in epoch milliseconds. */
interface SearchWindow {
  start: number;
  end: number;
}

/**
 * An {@link IMeshTraceSource} that answers the fleet's trace read-models from a Jaeger query service: a
 * trace by id (`GET /api/traces/{id}`), a correlation-id tag search + group, and the recent-flows list. A
 * second non-AWS reference realisation alongside `Benzene.Mesh.Fleet.Tempo`, reusing the same
 * `CompositeMeshFleetReadModel`, handlers, and UI - see `work/otel-fleet-adapter-scope.md`.
 *
 * Jaeger's search API requires a `service` (there is no "all services" query), so correlation and
 * recent-flows fan the search out across services - the configured {@link JaegerTraceSourceOptions.services}
 * or, when unset, the ones discovered via `GET /api/services`. Jaeger search returns **full** traces (not
 * summaries), so - unlike the Tempo adapter - recent flows carry a real span count and failure flag without
 * a second fetch. A reachable-but-unsuccessful response surfaces as undefined/empty (the topology adapter's
 * rule); a genuine connection failure (the `fetch` rejecting) throws and the composite's fetch-isolation
 * degrades that slice.
 *
 * `HttpClient` -> injectable `fetch` (mirroring `@benzene/mesh-tracing-tempo`'s query client); the body is
 * read on any `response.ok`, like `GetAsync` + `ReadAsStringAsync`. `CancellationToken` -> optional
 * `AbortSignal`; `DateTimeOffset` -> epoch-ms `number`.
 */
export class JaegerTraceSource implements IMeshTraceSource {
  /**
   * Creates the source over a `fetch`-like function and Jaeger endpoint/window options.
   * @param fetchFn The injectable `fetch` (defaults to the global `fetch`) - the port of C# `HttpClient`.
   * @param options Where and over what windows to query Jaeger.
   */
  constructor(
    private readonly fetchFn: JaegerFetch = fetch,
    private readonly options: JaegerTraceSourceOptions,
  ) {}

  async getTraceAsync(traceId: string, cancellationToken?: AbortSignal): Promise<TraceView | undefined> {
    if (traceId.length === 0) {
      return undefined;
    }

    const body = await this.getStringOrNull(
      `${this.options.jaegerUrl}/api/traces/${encodeURIComponent(traceId)}`,
      cancellationToken,
    );
    if (body === undefined) {
      return undefined;
    }

    const traces = JaegerTraceMapper.mapTraces(body);
    const match = traces.find((t) => t.traceId === traceId);
    const events = match?.events ?? traces[0]?.events;

    // Undefined (not empty) when Jaeger has no such trace, or it carried no Benzene topic-bearing span - so
    // the query handler answers NotFound, not an empty waterfall.
    if (events === undefined || events.length === 0) {
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

    const tags = `{"benzene.correlation-id":"${escape(correlationId)}"}`;
    const traces = await this.searchAcrossServices(
      this.resolveWindow(range, this.options.correlationLookbackMs),
      tags,
      cancellationToken,
    );

    const views = traces
      .filter((t) => t.events.length > 0)
      .map((t) => {
        const view = new TraceView();
        view.traceId = t.traceId;
        view.events = t.events;
        return view;
      })
      .sort((a, b) => earliestStart(a) - earliestStart(b)); // earliest-first, matching every other plane's correlation view

    if (views.length === 0) {
      return undefined;
    }

    const result = new CorrelationView();
    result.correlationId = correlationId;
    result.traces = views;
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

    const traces = await this.searchAcrossServices(
      this.resolveWindow(range, this.options.recentFlowsLookbackMs),
      undefined,
      cancellationToken,
    );

    return traces
      .filter((t) => t.events.length > 0) // mesh flows only (a trace with no Benzene span isn't one)
      .map(toTraceSummary)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  /**
   * Fan a search out across every service (Jaeger requires one per query), merge the returned full traces,
   * and dedupe by trace id (a cross-service trace is returned by each of its services).
   */
  private async searchAcrossServices(
    window: SearchWindow,
    tags: string | undefined,
    cancellationToken?: AbortSignal,
  ): Promise<JaegerMappedTrace[]> {
    const services = await this.getServices(cancellationToken);
    if (services.length === 0) {
      return [];
    }

    const startMicros = window.start * 1000;
    const endMicros = window.end * 1000;

    const byTraceId = new Map<string, JaegerMappedTrace>();
    for (const service of services) {
      let url =
        `${this.options.jaegerUrl}/api/traces?service=${encodeURIComponent(service)}` +
        `&start=${startMicros}&end=${endMicros}&limit=${this.options.searchLimitPerService}`;
      if (tags !== undefined) {
        url += `&tags=${encodeURIComponent(tags)}`;
      }

      const body = await this.getStringOrNull(url, cancellationToken);
      if (body === undefined) {
        continue;
      }

      for (const trace of JaegerTraceMapper.mapTraces(body)) {
        if (!byTraceId.has(trace.traceId)) {
          byTraceId.set(trace.traceId, trace);
        }
      }
    }

    return [...byTraceId.values()];
  }

  /** The services to search: the configured set, or those discovered via `/api/services`. */
  private async getServices(cancellationToken?: AbortSignal): Promise<readonly string[]> {
    if (this.options.services !== undefined && this.options.services.length > 0) {
      return this.options.services;
    }

    const body = await this.getStringOrNull(`${this.options.jaegerUrl}/api/services`, cancellationToken);
    if (body === undefined) {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(body);
      if (isObject(parsed) && Array.isArray(parsed.data)) {
        return parsed.data.filter((x): x is string => typeof x === 'string' && x.length > 0);
      }
    } catch {
      // Malformed body → no services, same reachable-but-unusable degradation as an HTTP error.
    }

    return [];
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

  /**
   * Resolve a requested {@link MeshTimeRange} to Jaeger's search `[start,end]`, falling back to
   * `now - fallbackMs` .. `now` when no window was requested (today's behavior). Jaeger's search needs a
   * bounded range either way.
   */
  private resolveWindow(range: MeshTimeRange | undefined, fallbackMs: number): SearchWindow {
    const resolved = MeshTimeRangeResolver.resolve(range, Date.now());
    if (resolved !== undefined) {
      return { start: resolved.from, end: resolved.to };
    }

    const end = Date.now();
    return { start: end - fallbackMs, end };
  }
}

/**
 * Jaeger search returns full traces, so a recent-flow row's span count, touched services, and failure flag
 * come straight from the mapped events - richer than a summary-only backend.
 */
function toTraceSummary(trace: JaegerMappedTrace): TraceSummary {
  const startedAt = Math.min(...trace.events.map((e) => e.startedAt));
  const end = Math.max(...trace.events.map((e) => e.startedAt + e.durationMs));
  const summary = new TraceSummary();
  summary.traceId = trace.traceId;
  summary.events = trace.events.length;
  summary.services = [
    ...new Set(trace.events.map((e) => e.service).filter((s): s is string => s !== undefined && s.length > 0)),
  ].sort(ordinalCompare);
  summary.startedAt = startedAt;
  summary.durationMs = end - startedAt;
  // Same success class the in-memory collector's trace summaries use (unknown/empty = failure).
  summary.failed = trace.events.some((e) => !BenzeneResultStatus.isSuccess(e.status));
  // The flow's entry topic: the earliest mapped event's.
  summary.topic = [...trace.events].sort((a, b) => a.startedAt - b.startedAt)[0].topic;
  return summary;
}

function earliestStart(trace: TraceView): number {
  return trace.events.length === 0 ? Number.MAX_SAFE_INTEGER : Math.min(...trace.events.map((e) => e.startedAt));
}

// Jaeger's tags filter is a JSON object string; escape the value so it can't break out of the literal.
function escape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function ordinalCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

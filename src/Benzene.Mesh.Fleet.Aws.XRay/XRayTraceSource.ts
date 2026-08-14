/** Port of Benzene.Mesh.Fleet.Aws.XRay.XRayTraceSource. */
import {
  BatchGetTracesCommand,
  GetTraceSummariesCommand,
  XRayClient,
} from '@aws-sdk/client-xray';
import type { TraceSummary as XRayTraceSummary } from '@aws-sdk/client-xray';
import {
  CorrelationView,
  IMeshTraceSource,
  MeshTimeRange,
  MeshTimeRangeResolver,
  TraceSummary,
  TraceView,
} from '@benzenejs/mesh-collector';
import { MeshTraceEvent } from '@benzenejs/mesh-wire';
import { XRaySegmentMapper } from './XRaySegmentMapper';
import { XRayTraceSourceOptions } from './XRayTraceSourceOptions';

// X-Ray's BatchGetTraces accepts at most 5 trace ids per call.
const BatchGetTracesMax = 5;

/** A resolved absolute search window, in epoch milliseconds. */
interface SearchWindow {
  start: number;
  end: number;
}

/**
 * An {@link IMeshTraceSource} that answers `mesh:query:trace` and `mesh:query:correlation` from AWS X-Ray:
 * it fetches a trace's segments with `BatchGetTraces` and maps the topic-bearing spans into a
 * {@link TraceView} (see {@link XRaySegmentMapper}), and finds a business correlation id's flows with
 * `GetTraceSummaries` filtered on the correlation-id annotation. The AWS realisation of the trace-backed
 * fleet reader scoped in `work/otel-fleet-adapter-scope.md`, reusing the same `CompositeMeshFleetReadModel`,
 * handlers, and UI as the Tempo/Jaeger adapters - no push collector required.
 *
 * Trace stats and service health are deliberately not sourced here (see {@link IMeshTraceSource}); X-Ray
 * traces are sampled, so counts would be biased, and X-Ray has no heartbeat feed. Those compose from an
 * `IMeshUsageSource` (CloudWatch) and the heartbeat plane in later increments.
 *
 * `IAmazonXRay` -> the `@aws-sdk/client-xray` `XRayClient` (`_xray.BatchGetTracesAsync(req)` ->
 * `xray.send(new BatchGetTracesCommand(input))`); the v3 SDK uses PascalCase shape members, so the request
 * and response shapes map almost 1:1 to the C#. C# two constructors (defaulted / explicit options) -> one
 * constructor with a defaulted `options`. `CancellationToken` -> optional `AbortSignal` (threaded to `send`
 * as `{ abortSignal }`); `DateTimeOffset` -> epoch-ms `number` (X-Ray's `StartTime`/`EndTime` are JS
 * `Date`); `Task.WhenAll` -> `Promise.all`; `StringComparer.Ordinal` -> {@link ordinalCompare}.
 */
export class XRayTraceSource implements IMeshTraceSource {
  private readonly xray: XRayClient;
  private readonly options: XRayTraceSourceOptions;

  /**
   * Creates the source over an X-Ray client (region/credentials come from the client) with optional tuning.
   * @param xray The `@aws-sdk/client-xray` client the source queries.
   * @param options Correlation + recent-flows tuning (lookback windows, enrichment cap); defaults if omitted.
   */
  constructor(xray: XRayClient, options: XRayTraceSourceOptions = new XRayTraceSourceOptions()) {
    this.xray = xray;
    this.options = options;
  }

  async getTraceAsync(traceId: string, cancellationToken?: AbortSignal): Promise<TraceView | undefined> {
    if (traceId.length === 0) {
      return undefined;
    }

    const events = await this.fetchEvents([traceId], traceId, cancellationToken);

    // Undefined (not empty) when X-Ray has no such trace, or a real trace that carried no Benzene
    // topic-bearing span - so the query handler answers NotFound, not an empty waterfall.
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

    const window = this.resolveWindow(range, this.options.correlationLookbackMs);
    // benzene.correlation-id lands in X-Ray as the underscore-sanitised annotation key; only annotations are
    // filterable (see work/otel-fleet-adapter-scope.md §6b).
    const filter = `annotation.benzene_correlation_id = "${escape(correlationId)}"`;

    const traceIds: string[] = [];
    let nextToken: string | undefined;
    do {
      const response = await this.xray.send(
        new GetTraceSummariesCommand({
          StartTime: new Date(window.start),
          EndTime: new Date(window.end),
          FilterExpression: filter,
          NextToken: nextToken,
        }),
        abortOptions(cancellationToken),
      );

      for (const summary of response.TraceSummaries ?? []) {
        if (summary.Id !== undefined && summary.Id.length > 0) {
          traceIds.push(summary.Id);
        }
      }

      nextToken = response.NextToken !== undefined && response.NextToken.length > 0 ? response.NextToken : undefined;
    } while (nextToken !== undefined);

    if (traceIds.length === 0) {
      return undefined;
    }

    const traces: TraceView[] = [];
    for (const batch of chunk(traceIds, BatchGetTracesMax)) {
      const response = await this.xray.send(
        new BatchGetTracesCommand({ TraceIds: batch }),
        abortOptions(cancellationToken),
      );

      for (const trace of response.Traces ?? []) {
        const segments = trace.Segments;
        if (segments === undefined || segments.length === 0 || trace.Id === undefined || trace.Id.length === 0) {
          continue;
        }

        const events = XRaySegmentMapper.map(
          trace.Id,
          segments.map((s) => s.Document),
        );
        if (events.length > 0) {
          const view = new TraceView();
          view.traceId = trace.Id;
          view.events = events;
          traces.push(view);
        }
      }
    }

    if (traces.length === 0) {
      return undefined;
    }

    // Earliest-first, the same ordering the in-memory collector's correlation view uses so the UI renders
    // both identically.
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

    const window = this.resolveWindow(range, this.options.recentFlowsLookbackMs);

    const summaries: XRayTraceSummary[] = [];
    let nextToken: string | undefined;
    do {
      const response = await this.xray.send(
        new GetTraceSummariesCommand({
          StartTime: new Date(window.start),
          EndTime: new Date(window.end),
          NextToken: nextToken,
        }),
        abortOptions(cancellationToken),
      );

      if (response.TraceSummaries !== undefined) {
        summaries.push(...response.TraceSummaries);
      }

      nextToken = response.NextToken !== undefined && response.NextToken.length > 0 ? response.NextToken : undefined;
      // Stop once we have comfortably more than the cap to sort a newest-first top-N from; the window, not
      // exhaustive paging, bounds a "recent flows" list.
    } while (nextToken !== undefined && summaries.length < limit * 4);

    // Select the newest N by the trace-id epoch (second-granularity, but enough to pick the right ~20), then
    // enrich those rows below. Ordering within a second is refined by the enriched millisecond start; the
    // final sort applies a stable trace-id tiebreaker so both planes are deterministic.
    const top = [...summaries]
      .sort((a, b) => {
        const byEpoch = parseTraceStart(b.Id) - parseTraceStart(a.Id);
        return byEpoch !== 0 ? byEpoch : ordinalCompare(b.Id ?? '', a.Id ?? '');
      })
      .slice(0, limit);

    const rows = await this.enrichRecentFlows(top, limit, cancellationToken);

    return rows.sort((a, b) => {
      const byStart = b.startedAt - a.startedAt;
      return byStart !== 0 ? byStart : ordinalCompare(b.traceId, a.traceId);
    });
  }

  /**
   * Enrich the chosen summaries with real span data by batching {@link BatchGetTracesMax} ids per
   * `BatchGetTraces` call (parallel, per-batch fetch-isolation). A trace that maps to Benzene events becomes
   * an enriched row (benzene.service names, ms start, real span count); a trace with no Benzene span or a
   * failed batch keeps its summary-plane row. Skips all fetches when enrichment is off
   * ({@link XRayTraceSourceOptions.recentFlowsServiceEnrichmentMax} = 0).
   */
  private async enrichRecentFlows(
    summaries: readonly XRayTraceSummary[],
    limit: number,
    cancellationToken?: AbortSignal,
  ): Promise<TraceSummary[]> {
    const enrichMax = Math.min(Math.max(this.options.recentFlowsServiceEnrichmentMax, 0), limit);
    if (enrichMax === 0) {
      return summaries.map(toSummaryPlaneRow);
    }

    // Which trace ids to enrich (the first enrichMax that have an id); the rest stay summary-plane.
    const toEnrich = summaries
      .filter((s) => s.Id !== undefined && s.Id.length > 0)
      .slice(0, enrichMax)
      .map((s) => s.Id as string);

    const mapped = new Map<string, MeshTraceEvent[]>();
    const batches = await Promise.all(
      chunk(toEnrich, BatchGetTracesMax).map((ids) => this.fetchBatch(ids, cancellationToken)),
    );
    for (const batch of batches) {
      for (const [id, events] of batch) {
        mapped.set(id, events);
      }
    }

    // Enriched row where the trace mapped to at least one Benzene event; summary-plane fallback otherwise.
    return summaries.map((s) => {
      const events = s.Id !== undefined ? mapped.get(s.Id) : undefined;
      return events !== undefined && events.length > 0 ? enrichedRow(s, events) : toSummaryPlaneRow(s);
    });
  }

  /**
   * Fetch a <=5-id batch from X-Ray and map each returned trace's segments to events. A failed batch leaves
   * its rows on the summary plane (fetch isolation), never the whole list.
   */
  private async fetchBatch(
    ids: string[],
    cancellationToken?: AbortSignal,
  ): Promise<Map<string, MeshTraceEvent[]>> {
    const result = new Map<string, MeshTraceEvent[]>();
    try {
      const response = await this.xray.send(
        new BatchGetTracesCommand({ TraceIds: ids }),
        abortOptions(cancellationToken),
      );

      for (const trace of response.Traces ?? []) {
        const segments = trace.Segments;
        if (segments === undefined || segments.length === 0 || trace.Id === undefined || trace.Id.length === 0) {
          continue;
        }

        result.set(
          trace.Id,
          XRaySegmentMapper.map(
            trace.Id,
            segments.map((s) => s.Document),
          ),
        );
      }
    } catch {
      // Fetch isolation: a failed batch leaves its <=5 rows on the summary plane, never the whole list.
    }

    return result;
  }

  /**
   * Fetch the given trace ids from X-Ray and map the returned segments to events under one mesh trace id (a
   * single trace's lookup).
   */
  private async fetchEvents(
    traceIds: string[],
    meshTraceId: string,
    cancellationToken?: AbortSignal,
  ): Promise<MeshTraceEvent[]> {
    const response = await this.xray.send(
      new BatchGetTracesCommand({ TraceIds: traceIds }),
      abortOptions(cancellationToken),
    );

    // X-Ray returns an unknown id in UnprocessedTraceIds (not Traces), so an unknown trace yields no segments
    // here -> an empty event list -> a null view upstream.
    const documents: (string | undefined)[] = [];
    for (const trace of response.Traces ?? []) {
      const segments = trace.Segments;
      if (segments !== undefined && segments.length > 0) {
        for (const segment of segments) {
          documents.push(segment.Document);
        }
      }
    }

    return XRaySegmentMapper.map(meshTraceId, documents);
  }

  /**
   * Resolve a requested {@link MeshTimeRange} to X-Ray's `[start,end]`, falling back to `now - fallbackMs`
   * .. `now` when no window was requested (today's behavior). X-Ray's `GetTraceSummaries` needs a bounded
   * range either way.
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
 * An enriched recent-flows row: real service names (benzene.service, from the mapped events), the earliest
 * event's millisecond start, and the real span count. Keeps the summary's authoritative error flag
 * (`HasError`/`HasFault`) and duration.
 */
function enrichedRow(summary: XRayTraceSummary, events: MeshTraceEvent[]): TraceSummary {
  const row = new TraceSummary();
  row.traceId = summary.Id ?? '';
  // X-Ray Duration is in seconds; the mesh carries milliseconds.
  row.durationMs = (summary.Duration ?? 0) * 1000;
  row.failed = (summary.HasError ?? false) || (summary.HasFault ?? false);
  row.services = [
    ...new Set(events.map((e) => e.service).filter((name): name is string => name !== undefined && name.length > 0)),
  ].sort(ordinalCompare);
  row.startedAt = Math.min(...events.map((e) => e.startedAt));
  row.events = events.length;
  // The flow's entry topic: the earliest mapped event's (map returns events in start order).
  row.topic = events[0].topic;
  return row;
}

function toSummaryPlaneRow(summary: XRayTraceSummary): TraceSummary {
  const row = new TraceSummary();
  row.traceId = summary.Id ?? '';
  // X-Ray Duration is in seconds; the mesh carries milliseconds.
  row.durationMs = (summary.Duration ?? 0) * 1000;
  row.failed = (summary.HasError ?? false) || (summary.HasFault ?? false);
  row.services = [
    ...new Set(
      (summary.ServiceIds ?? [])
        .map((s) => s.Name)
        .filter((name): name is string => name !== undefined && name.length > 0),
    ),
  ];
  row.startedAt = parseTraceStart(summary.Id);
  row.events = 0; // X-Ray summaries carry no span count; the drill-in trace has it.
  return row;
}

/**
 * An X-Ray trace id is `1-{8 hex epoch seconds}-{24 hex}`; the middle group is the trace's start time. Falls
 * back to `0` (the epoch, the TS analog of C# `DateTimeOffset.MinValue` used only for ordering) for an
 * unparseable id.
 */
function parseTraceStart(traceId: string | undefined): number {
  if (traceId !== undefined) {
    const parts = traceId.split('-');
    if (parts.length >= 2 && /^[0-9a-fA-F]{1,15}$/.test(parts[1])) {
      const epoch = parseInt(parts[1], 16);
      if (!Number.isNaN(epoch)) {
        return epoch * 1000;
      }
    }
  }

  return 0;
}

function earliestStart(trace: TraceView): number {
  return trace.events.length === 0 ? Number.MAX_SAFE_INTEGER : Math.min(...trace.events.map((e) => e.startedAt));
}

// X-Ray filter-expression string literals are double-quoted; escape backslashes and quotes so a correlation
// id can't break out of the literal.
function escape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function chunk(items: readonly string[], size: number): string[][] {
  const result: string[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

function ordinalCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Thread the optional `AbortSignal` to the SDK's `send` as its `HttpHandlerOptions`, or omit it. */
function abortOptions(cancellationToken?: AbortSignal): { abortSignal: AbortSignal } | undefined {
  return cancellationToken !== undefined ? { abortSignal: cancellationToken } : undefined;
}

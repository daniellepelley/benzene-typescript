/** Port of Benzene.Mesh.Collector.IMeshTraceSource. */
import { ServiceToken, serviceToken } from '@benzenejs/abstractions';
import { CorrelationView, MeshTimeRange, TraceSummary, TraceView } from './Views';

/**
 * A pluggable source of the *trace-shaped* fleet read-models - a query API over an existing observability
 * trace backend (AWS X-Ray, Grafana Tempo, Jaeger). Implemented per backend in a `Benzene.Mesh.Fleet.*`
 * adapter package; composed into an {@link IMeshFleetReadModel} by {@link CompositeMeshFleetReadModel},
 * alongside an `IMeshUsageSource` for stats and the heartbeat feed (or absent) for health.
 *
 * Per-topic/service *counts* and service *health* are deliberately NOT on this interface: traces are
 * sampled (counts would be biased) and a trace store has no heartbeat feed. Those come from their own
 * sources. This is a trace / correlation / recent-flows reader.
 *
 * `CancellationToken` -> optional `AbortSignal`; `Task<T?>` -> `Promise<T | undefined>`; `IReadOnlyList<T>`
 * -> `readonly T[]`.
 */
export interface IMeshTraceSource {
  /** Fetch one flow's events (a {@link TraceView}) by trace id, or `undefined` if the backend has no such trace. */
  getTraceAsync(traceId: string, cancellationToken?: AbortSignal): Promise<TraceView | undefined>;

  /**
   * Fetch every flow that carried a business correlation id, grouped by trace (a {@link CorrelationView}),
   * or `undefined` if none matched. A correlation id can span more than one trace, so the backend searches
   * its traces by the correlation-id span attribute and returns one {@link TraceView} per matching trace. An
   * optional `range` bounds the search window; `undefined` => the adapter's configured correlation lookback.
   */
  getCorrelationAsync(
    correlationId: string,
    range?: MeshTimeRange,
    cancellationToken?: AbortSignal,
  ): Promise<CorrelationView | undefined>;

  /**
   * List the most recent flows (up to `limit`, newest first) as {@link TraceSummary} rows for the fleet
   * view - one per trace, carrying only per-flow facts (duration, failed, the services it touched).
   * Deliberately a summary, not the events. {@link TraceSummary.events} may be 0 when the backend's summary
   * shape carries no span count. An optional `range` bounds the window; `undefined` => the adapter's
   * configured recent-flows lookback.
   */
  getRecentFlowsAsync(
    limit?: number,
    range?: MeshTimeRange,
    cancellationToken?: AbortSignal,
  ): Promise<readonly TraceSummary[]>;
}

/** Container token: a trace source is resolved via `getService(IMeshTraceSource)`. */
export const IMeshTraceSource: ServiceToken<IMeshTraceSource> =
  serviceToken<IMeshTraceSource>('IMeshTraceSource');

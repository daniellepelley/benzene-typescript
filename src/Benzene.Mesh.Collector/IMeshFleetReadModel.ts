/** Port of Benzene.Mesh.Collector.IMeshFleetReadModel. */
import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { CorrelationView, FleetView, MeshTimeRange, ServiceView, TopicSummary, TraceView } from './Views';

/**
 * The read side of the fleet the `mesh:query:*` handlers answer - the seam that makes the fleet UI's data
 * source swappable. The in-memory {@link MeshCollectorStore} is one implementation (push-collector plane); a
 * backend-composed implementation ({@link CompositeMeshFleetReadModel} / `Benzene.Mesh.Fleet.*`) reads
 * traces from an OTel trace store and stats from an `IMeshUsageSource`. Async because a backend-composed
 * reader does I/O; the in-memory store just wraps its sync methods.
 *
 * `CancellationToken` -> optional `AbortSignal`; `Task<T?>` -> `Promise<T | undefined>`. The C# pair of
 * `FleetAsync` methods (the second, a *default interface member*, adds the `includeFlows` cost hint) collapse
 * into one method with an optional `includeFlows` parameter - TypeScript interfaces have no default members,
 * and an optional parameter is the idiomatic equivalent (the in-memory store ignores it; a trace-backed
 * plane may honor it).
 */
export interface IMeshFleetReadModel {
  /**
   * The whole known fleet - services, topic catalog, recent flows (`mesh:query:fleet`). An optional `range`
   * windows the recent flows (and, where the plane can, the counts); `undefined` => unfiltered. When
   * `includeFlows` is false the caller only needs the windowed counts, so a plane that pays per flow lookup
   * may skip the flows and return an empty {@link FleetView.traces}; `undefined`/absent => true, exactly
   * today's behavior. It is a cost hint, never a contract change - an empty flows list was always a legal
   * degraded-plane answer.
   */
  fleetAsync(
    range?: MeshTimeRange,
    includeFlows?: boolean,
    cancellationToken?: AbortSignal,
  ): Promise<FleetView>;

  /**
   * One service's detail, or `undefined` if unknown (`mesh:query:service`). Optional `range` windows the
   * service's live flows; `undefined` => unfiltered.
   */
  serviceAsync(
    name: string,
    range?: MeshTimeRange,
    cancellationToken?: AbortSignal,
  ): Promise<ServiceView | undefined>;

  /**
   * One topic's summary, or `undefined` if unknown (`mesh:query:topic`). Optional `range` windows the
   * topic's live flows; `undefined` => unfiltered.
   */
  topicAsync(
    id: string,
    version: string | undefined,
    range?: MeshTimeRange,
    cancellationToken?: AbortSignal,
  ): Promise<TopicSummary | undefined>;

  /**
   * One flow's events in start order -> the waterfall, or `undefined` if unknown (`mesh:query:trace`). A
   * trace lookup is by id and takes no window.
   */
  traceAsync(traceId: string, cancellationToken?: AbortSignal): Promise<TraceView | undefined>;

  /**
   * Every flow that carried a business correlation id, or `undefined` if none (`mesh:query:correlation`).
   * Optional `range` windows the search; `undefined` => unfiltered.
   */
  correlationAsync(
    correlationId: string,
    range?: MeshTimeRange,
    cancellationToken?: AbortSignal,
  ): Promise<CorrelationView | undefined>;
}

/** Container token: the query handlers resolve the fleet read model via `getService(IMeshFleetReadModel)`. */
export const IMeshFleetReadModel: ServiceToken<IMeshFleetReadModel> =
  serviceToken<IMeshFleetReadModel>('IMeshFleetReadModel');

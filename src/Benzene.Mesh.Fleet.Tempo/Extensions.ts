/** Port of Benzene.Mesh.Fleet.Tempo.Extensions. */
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import {
  CompositeMeshFleetReadModel,
  IMeshFleetReadModel,
  IMeshTraceSource,
} from '@benzenejs/mesh-collector';
import { IMeshUsageSource } from '@benzenejs/mesh-contracts';
import { TempoTraceSource } from './TempoTraceSource';
import { TempoTraceSourceOptions } from './TempoTraceSourceOptions';

/**
 * Registers a {@link TempoTraceSource} as the {@link IMeshTraceSource} and composes it - with whatever
 * `IMeshUsageSource`s are registered - into a `CompositeMeshFleetReadModel` serving
 * {@link IMeshFleetReadModel}, so the whole fleet view (trace + correlation + recent flows from Tempo, topic
 * stats from a usage feed if one is wired) answers off Tempo. Wire the read side with
 * `useMessageHandlers(meshCollectorQueries)` and point the mesh UI's live Fleet plane at it with
 * `useMeshUi(..., envelopeUrl: '/benzene/invoke')`; no `MeshCollectorStore` is needed - there is no push
 * ingestion. C# extension method -> free function.
 *
 * Add a usage source separately for topic stats; without one the composite still serves
 * traces/correlation/recent-flows/services and reports no topic stats (honest empty). Per-service and
 * single-topic pages stay omitted (no descriptor feed here).
 *
 * Divergence from the C# original: the C# registers an `HttpClient` (unless one is already registered); this
 * port injects Node's global `fetch` into the source instead (`HttpClient` -> `fetch`, mirroring
 * `@benzenejs/mesh-tracing-tempo`), so there is no `HttpClient` service to register.
 *
 * @param services The service container to register with.
 * @param options Where and over what windows to query Tempo's trace API.
 * @returns The service container for method chaining.
 */
export function addTempoFleetReadModel(
  services: IBenzeneServiceContainer,
  options: TempoTraceSourceOptions,
): IBenzeneServiceContainer {
  services.addSingletonInstance(TempoTraceSourceOptions, options);
  services.addSingletonFactory(
    IMeshTraceSource,
    (resolver) => new TempoTraceSource(fetch, resolver.getService(TempoTraceSourceOptions)),
  );
  services.addSingletonFactory(
    IMeshFleetReadModel,
    (resolver) => new CompositeMeshFleetReadModel(resolver.getService(IMeshTraceSource), resolver.getServices(IMeshUsageSource)),
  );
  return services;
}

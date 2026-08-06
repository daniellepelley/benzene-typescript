/** Port of Benzene.Mesh.Fleet.Jaeger.Extensions. */
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import {
  CompositeMeshFleetReadModel,
  IMeshFleetReadModel,
  IMeshTraceSource,
} from '@benzene/mesh-collector';
import { IMeshUsageSource } from '@benzene/mesh-contracts';
import { JaegerTraceSource } from './JaegerTraceSource';
import { JaegerTraceSourceOptions } from './JaegerTraceSourceOptions';

/**
 * Registers a {@link JaegerTraceSource} as the {@link IMeshTraceSource} and composes it - with whatever
 * `IMeshUsageSource`s are registered - into a `CompositeMeshFleetReadModel` serving
 * {@link IMeshFleetReadModel}. Wire the read side with `useMessageHandlers(meshCollectorQueries)` and point
 * the mesh UI's live Fleet plane at it with `useMeshUi(..., envelopeUrl: '/benzene/invoke')`; no
 * `MeshCollectorStore` is needed - there is no push ingestion. C# extension method -> free function.
 *
 * Add a usage source separately for topic stats; without one the composite still serves
 * traces/correlation/recent-flows/services and reports no topic stats (honest empty). Per-service and
 * single-topic pages stay omitted (no descriptor feed here).
 *
 * Divergence from the C# original: the C# registers an `HttpClient` (unless one is already registered); this
 * port injects Node's global `fetch` into the source instead (`HttpClient` -> `fetch`, mirroring
 * `@benzene/mesh-tracing-tempo`), so there is no `HttpClient` service to register.
 *
 * @param services The service container to register with.
 * @param options Where and over what windows to query Jaeger.
 * @returns The service container for method chaining.
 */
export function addJaegerFleetReadModel(
  services: IBenzeneServiceContainer,
  options: JaegerTraceSourceOptions,
): IBenzeneServiceContainer {
  services.addSingletonInstance(JaegerTraceSourceOptions, options);
  services.addSingletonFactory(
    IMeshTraceSource,
    (resolver) => new JaegerTraceSource(fetch, resolver.getService(JaegerTraceSourceOptions)),
  );
  services.addSingletonFactory(
    IMeshFleetReadModel,
    (resolver) => new CompositeMeshFleetReadModel(resolver.getService(IMeshTraceSource), resolver.getServices(IMeshUsageSource)),
  );
  return services;
}

/** Port of Benzene.Mesh.Fleet.Aws.XRay.Extensions. */
import { XRayClient } from '@aws-sdk/client-xray';
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import {
  CompositeMeshFleetReadModel,
  IMeshFleetReadModel,
  IMeshTraceSource,
} from '@benzene/mesh-collector';
import { IMeshUsageSource } from '@benzene/mesh-contracts';
import { XRayTraceSource } from './XRayTraceSource';
import { XRayTraceSourceOptions } from './XRayTraceSourceOptions';

/**
 * Registers an {@link XRayTraceSource} as the {@link IMeshTraceSource} and composes it - with whatever
 * `IMeshUsageSource`s are registered (e.g. a CloudWatch usage source) - into a
 * `CompositeMeshFleetReadModel` serving {@link IMeshFleetReadModel}, so the whole fleet view (trace +
 * correlation from X-Ray, topic stats from the usage feed, recent flows + anonymous services from X-Ray)
 * answers on the AWS plane. Wire the read side with `useMessageHandlers(meshCollectorQueries)` and point the
 * mesh UI's live Fleet plane at it with `useMeshUi(..., envelopeUrl: '/benzene/invoke')`; no
 * `MeshCollectorStore` is needed - there is no push ingestion, only queries against X-Ray + the usage
 * backend. C# extension method -> free function.
 *
 * Add a usage source separately for topic stats; without one the composite still serves
 * traces/correlation/recent-flows/services and reports no topic stats (honest empty), rather than
 * fabricating counts. Per-service and single-topic pages stay omitted (no descriptor feed on this plane).
 *
 * Divergence from the C# original: the C# registers a default `IAmazonXRay` in the container (unless one is
 * already registered), the same pattern as `AddCloudWatchUsage`; this port has no ambient
 * container-registered AWS client, so the `IMeshTraceSource` factory constructs `new XRayClient({})`
 * directly - resolving region and credentials from the ambient AWS environment (on Lambda, the execution
 * role), the same pattern as the `addSqs*` extensions.
 *
 * @param services The service container to register with.
 * @param options Correlation + recent-flows tuning (lookback windows); defaults if omitted.
 * @returns The service container for method chaining.
 */
export function addXRayFleetReadModel(
  services: IBenzeneServiceContainer,
  options: XRayTraceSourceOptions = new XRayTraceSourceOptions(),
): IBenzeneServiceContainer {
  services.addSingletonInstance(XRayTraceSourceOptions, options);
  services.addSingletonFactory(
    IMeshTraceSource,
    (resolver) => new XRayTraceSource(new XRayClient({}), resolver.getService(XRayTraceSourceOptions)),
  );
  services.addSingletonFactory(
    IMeshFleetReadModel,
    (resolver) =>
      new CompositeMeshFleetReadModel(resolver.getService(IMeshTraceSource), resolver.getServices(IMeshUsageSource)),
  );
  return services;
}

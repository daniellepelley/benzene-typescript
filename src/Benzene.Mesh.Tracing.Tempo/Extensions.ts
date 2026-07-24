/** Port of Benzene.Mesh.Tracing.Tempo.Extensions. */
import { IBenzeneServiceContainer, VoidResult } from '@benzene/abstractions';
import { IMessageHandlerDefinition } from '@benzene/abstractions-message-handlers';
import { MessageHandlerDefinition } from '@benzene/core-message-handlers';
import { HttpEndpointDefinition, IHttpEndpointDefinition } from '@benzene/http';
import { IMeshArtifactStore } from '@benzene/mesh-aggregator';
import { MeshTopology } from '@benzene/mesh-contracts';
import { PrometheusQueryClient } from './PrometheusQueryClient';
import { TempoServiceGraphTopologyBuilder } from './TempoServiceGraphTopologyBuilder';
import { TempoTopologyMessageHandler } from './TempoTopologyMessageHandler';
import { TempoTopologyOptions } from './TempoTopologyOptions';

/**
 * Registers `TempoServiceGraphTopologyBuilder`, backed by a `PrometheusQueryClient`, against the given
 * `options`, plus the `mesh:topology` handler and its `POST /mesh/topology` endpoint. C# extension method
 * -> free function.
 *
 * Deliberately does not register an `IMeshArtifactStore` - this requires `addMeshAggregator(...)` to already
 * be registered in the same container, so `topology.json` is published to the same artifact store
 * `manifest.json`/`services/*.json` are. As in the C# original, resolving the handler without that
 * prerequisite fails at DI-resolution time. (Unlike C#, the handler is registered here rather than
 * discovered by an assembly scan - the port's Extensions-registration convention, since JS has no scan or
 * constructor-parameter reflection.)
 */
export function addTempoTopology(
  services: IBenzeneServiceContainer,
  options: TempoTopologyOptions,
): IBenzeneServiceContainer {
  services.addSingletonInstance(TempoTopologyOptions, options);
  services.addSingletonFactory(PrometheusQueryClient, () => new PrometheusQueryClient());
  services.addSingletonFactory(
    TempoServiceGraphTopologyBuilder,
    (resolver) => new TempoServiceGraphTopologyBuilder(resolver.getService(PrometheusQueryClient), resolver.getService(TempoTopologyOptions)),
  );

  services.addScopedFactory(
    TempoTopologyMessageHandler,
    (resolver) => new TempoTopologyMessageHandler(resolver.getService(TempoServiceGraphTopologyBuilder), resolver.getService(IMeshArtifactStore)),
  );
  services.addSingletonInstance(
    IMessageHandlerDefinition,
    MessageHandlerDefinition.createInstance('mesh:topology', '', VoidResult, MeshTopology, TempoTopologyMessageHandler),
  );
  services.addSingletonInstance(IHttpEndpointDefinition, HttpEndpointDefinition.createInstance('POST', '/mesh/topology', 'mesh:topology'));

  return services;
}

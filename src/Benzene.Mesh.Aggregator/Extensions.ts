/** Port of Benzene.Mesh.Aggregator.Extensions. */
import { Constructor, IBenzeneServiceContainer, IServiceResolver, ServiceIdentifier, VoidResult } from '@benzenejs/abstractions';
import { IMessageHandlerDefinition } from '@benzenejs/abstractions-message-handlers';
import { MessageHandlerDefinition } from '@benzenejs/core-message-handlers';
import { HttpEndpointDefinition, IHttpEndpointDefinition } from '@benzenejs/http';
import {
  IMeshReportPublisher,
  IMeshUsageSource,
  MeshAnnotationRequest,
  MeshAnnotationThread,
  MeshManifest,
  MeshServiceRegistry,
  MeshServiceReport,
} from '@benzenejs/mesh-contracts';
import { ArtifactStoreMeshReportPublisher } from './ArtifactStoreMeshReportPublisher';
import { FileSystemMeshArtifactStore } from './FileSystemMeshArtifactStore';
import { HttpMeshServiceSource } from './HttpMeshServiceSource';
import { IMeshArtifactStore } from './IMeshArtifactStore';
import { IMeshServiceSource } from './IMeshServiceSource';
import { MeshAggregateMessageHandler } from './MeshAggregateMessageHandler';
import { MeshAggregator } from './MeshAggregator';
import { MeshAnnotationPublisher } from './MeshAnnotationPublisher';
import { MeshAnnotationsMessageHandler } from './MeshAnnotationsMessageHandler';
import { MeshReportMessageHandler } from './MeshReportMessageHandler';

/**
 * Registers `MeshAggregator` (backed by a `FileSystemMeshArtifactStore` when given a directory string, or a
 * caller-supplied `IMeshArtifactStore` factory for a blob-storage adapter) against the given service
 * registry, plus the three mesh message handlers and their HTTP endpoints. C# extension method + two
 * overloads -> one free function whose third argument is a directory string or a store factory.
 *
 * Unlike the C# `AddMeshAggregator` (which registers only the infra and leaves handler *discovery* to the
 * app's assembly-scanning `.AddMessageHandlers()`), the port also registers the handler definitions,
 * endpoints and scoped factories here: JS has no assembly scan or constructor-parameter reflection, so a
 * handler with dependencies can't be discovered or activated without an explicit factory (the same
 * container-registration convention `@benzenejs/mesh-dispatch` uses). The default `HttpMeshServiceSource` and
 * `ArtifactStoreMeshReportPublisher` are registered too; other adapter packages add their own
 * `IMeshServiceSource`/`IMeshReportPublisher` alongside.
 */
export function addMeshAggregator(
  services: IBenzeneServiceContainer,
  registry: MeshServiceRegistry,
  artifactStore: string | ((resolver: IServiceResolver) => IMeshArtifactStore),
): IBenzeneServiceContainer {
  const storeFactory =
    typeof artifactStore === 'string'
      ? () => new FileSystemMeshArtifactStore(artifactStore)
      : artifactStore;

  services.addSingletonInstance(MeshServiceRegistry, registry);
  services.addSingletonFactory(IMeshArtifactStore, (resolver) => storeFactory(resolver));
  // The default IMeshServiceSource - other adapter packages add their own IMeshServiceSource registration
  // alongside this one; MeshAggregator resolves all of them via getServices(IMeshServiceSource), keyed by key.
  services.addSingletonFactory(IMeshServiceSource, () => new HttpMeshServiceSource());
  // The default push-path IMeshReportPublisher - MeshReportMessageHandler resolves this.
  services.addSingletonFactory(
    IMeshReportPublisher,
    (resolver) => new ArtifactStoreMeshReportPublisher(resolver.getService(IMeshArtifactStore)),
  );
  services.addSingletonFactory(
    MeshAnnotationPublisher,
    (resolver) => new MeshAnnotationPublisher(resolver.getService(IMeshArtifactStore)),
  );
  services.addSingletonFactory(
    MeshAggregator,
    (resolver) =>
      new MeshAggregator(
        resolver.getServices(IMeshServiceSource),
        resolver.getService(IMeshArtifactStore),
        undefined,
        resolver.getServices(IMeshUsageSource),
      ),
  );

  registerHandler(
    services,
    'benzene:mesh:aggregate',
    'POST',
    '/mesh/aggregate',
    VoidResult,
    MeshManifest,
    MeshAggregateMessageHandler,
    (resolver) => new MeshAggregateMessageHandler(resolver.getService(MeshAggregator), resolver.getService(MeshServiceRegistry)),
  );
  registerHandler(
    services,
    'benzene:mesh:report',
    'POST',
    '/mesh/report',
    MeshServiceReport,
    VoidResult,
    MeshReportMessageHandler,
    (resolver) => new MeshReportMessageHandler(resolver.getService(IMeshReportPublisher)),
  );
  registerHandler(
    services,
    'benzene:mesh:annotations:add',
    'POST',
    '/mesh/annotations',
    MeshAnnotationRequest,
    MeshAnnotationThread,
    MeshAnnotationsMessageHandler,
    (resolver) => new MeshAnnotationsMessageHandler(resolver.getService(MeshAnnotationPublisher)),
  );

  return services;
}

function registerHandler<T>(
  services: IBenzeneServiceContainer,
  topic: string,
  method: string,
  path: string,
  requestType: ServiceIdentifier<unknown>,
  responseType: ServiceIdentifier<unknown>,
  handlerType: Constructor<T>,
  factory: (resolver: IServiceResolver) => T,
): void {
  services.addScopedFactory(handlerType, factory);
  services.addSingletonInstance(
    IMessageHandlerDefinition,
    MessageHandlerDefinition.createInstance(topic, '', requestType, responseType, handlerType),
  );
  services.addSingletonInstance(IHttpEndpointDefinition, HttpEndpointDefinition.createInstance(method, path, topic));
}

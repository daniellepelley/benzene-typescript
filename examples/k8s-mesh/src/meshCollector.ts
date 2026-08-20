/**
 * Wires `@benzenejs/mesh-collector`'s nine handlers onto a container — the live spec collector behind
 * the mesh's own `/benzene/invoke` (see `meshApp.ts`), which services report to
 * (`MESH_COLLECTOR_ENVELOPE_URL`) and the Mesh UI's Fleet plane polls. Mirrors .NET Mesh/Startup.cs'
 * `MeshCollectorStore` + `IMeshFleetReadModel` + `.UseBenzeneMessage(..., collector =>
 * collector.UseMessageHandlers(MeshCollectorHandlers.All))`.
 *
 * `MeshCollectorHandlers`' classes carry no `@message`/`@httpEndpoint` decorators (there is no C#
 * `[Message]` equivalent for them — see the package's own header comment), so each is bound to its
 * topic explicitly here, the same `IMessageHandlerDefinition` + scoped-factory pattern
 * `@benzenejs/mesh-aggregator`'s own `addMeshAggregator` uses for its three handlers.
 */
import { Constructor, IBenzeneServiceContainer, IServiceResolver, ServiceIdentifier } from '@benzenejs/abstractions';
import { IMessageHandlerDefinition } from '@benzenejs/abstractions-message-handlers';
import { MessageHandlerDefinition } from '@benzenejs/core-message-handlers';
import {
  Ack,
  CorrelationQuery,
  CorrelationQueryMessageHandler,
  CorrelationView,
  FleetQuery,
  FleetQueryMessageHandler,
  FleetView,
  HeartbeatMessageHandler,
  IMeshFleetReadModel,
  IssuesMessageHandler,
  MeshCollectorStore,
  MeshCollectorTopics,
  RegisterMessageHandler,
  ServiceQuery,
  ServiceQueryMessageHandler,
  ServiceView,
  TopicQuery,
  TopicQueryMessageHandler,
  TopicSummary,
  TraceQuery,
  TraceQueryMessageHandler,
  TraceView,
  TracesMessageHandler,
} from '@benzenejs/mesh-collector';
import { MeshHeartbeat, MeshIssueBatch, MeshServiceDescriptor, MeshTraceBatch } from '@benzenejs/mesh-wire';

export function addMeshCollector(container: IBenzeneServiceContainer): void {
  container.addSingletonFactory(MeshCollectorStore, () => new MeshCollectorStore());
  container.addSingletonFactory(IMeshFleetReadModel, (resolver) => resolver.getService(MeshCollectorStore));

  // The ingest quartet — depend on the store directly.
  registerHandler(container, MeshCollectorTopics.register, MeshServiceDescriptor, Ack, RegisterMessageHandler, (r) =>
    new RegisterMessageHandler(r.getService(MeshCollectorStore)),
  );
  registerHandler(container, MeshCollectorTopics.heartbeat, MeshHeartbeat, Ack, HeartbeatMessageHandler, (r) =>
    new HeartbeatMessageHandler(r.getService(MeshCollectorStore)),
  );
  registerHandler(container, MeshCollectorTopics.traces, MeshTraceBatch, Ack, TracesMessageHandler, (r) =>
    new TracesMessageHandler(r.getService(MeshCollectorStore)),
  );
  registerHandler(container, MeshCollectorTopics.issues, MeshIssueBatch, Ack, IssuesMessageHandler, (r) =>
    new IssuesMessageHandler(r.getService(MeshCollectorStore)),
  );

  // The benzene:mesh:query:* read models — depend only on IMeshFleetReadModel.
  registerHandler(container, MeshCollectorTopics.queryFleet, FleetQuery, FleetView, FleetQueryMessageHandler, (r) =>
    new FleetQueryMessageHandler(r.getService(IMeshFleetReadModel)),
  );
  registerHandler(container, MeshCollectorTopics.queryService, ServiceQuery, ServiceView, ServiceQueryMessageHandler, (r) =>
    new ServiceQueryMessageHandler(r.getService(IMeshFleetReadModel)),
  );
  registerHandler(container, MeshCollectorTopics.queryTopic, TopicQuery, TopicSummary, TopicQueryMessageHandler, (r) =>
    new TopicQueryMessageHandler(r.getService(IMeshFleetReadModel)),
  );
  registerHandler(container, MeshCollectorTopics.queryTrace, TraceQuery, TraceView, TraceQueryMessageHandler, (r) =>
    new TraceQueryMessageHandler(r.getService(IMeshFleetReadModel)),
  );
  registerHandler(
    container,
    MeshCollectorTopics.queryCorrelation,
    CorrelationQuery,
    CorrelationView,
    CorrelationQueryMessageHandler,
    (r) => new CorrelationQueryMessageHandler(r.getService(IMeshFleetReadModel)),
  );
}

function registerHandler<T>(
  container: IBenzeneServiceContainer,
  topic: string,
  requestType: ServiceIdentifier<unknown>,
  responseType: ServiceIdentifier<unknown>,
  handlerType: Constructor<T>,
  factory: (resolver: IServiceResolver) => T,
): void {
  container.addScopedFactory(handlerType, factory);
  container.addSingletonInstance(
    IMessageHandlerDefinition,
    MessageHandlerDefinition.createInstance(topic, '', requestType, responseType, handlerType),
  );
}

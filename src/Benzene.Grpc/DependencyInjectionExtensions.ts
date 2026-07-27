import { IBenzeneServiceContainer, tryAddScoped, tryAddSingleton } from '@benzene/abstractions';
import {
  IMessageHandlerResultSetter,
  IMessageTopicGetter,
  IRequestMapper,
  ITransportInfo,
  TransportNames,
} from '@benzene/abstractions-message-handlers';
import { IMessageBodyGetter, IMessageHeadersGetter } from '@benzene/abstractions-messages';
import {
  addContextItems,
  addHeaderMessageVersionGetter,
  TransportInfo,
} from '@benzene/core-message-handlers';
import { DefaultGrpcStatusCodeMapper } from './DefaultGrpcStatusCodeMapper';
import { GrpcContext } from './GrpcContext';
import { GrpcMessageBodyGetter } from './GrpcMessageBodyGetter';
import { GrpcMessageHandlerResultSetter } from './GrpcMessageHandlerResultSetter';
import { GrpcMessageHeadersGetter } from './GrpcMessageHeadersGetter';
import { GrpcMessageTopicGetter } from './GrpcMessageTopicGetter';
import { GrpcRequestMapper } from './GrpcRequestMapper';
import { GrpcRouteFinder } from './GrpcRouteFinder';
import { GrpcServerCallAccessor } from './GrpcServerCallAccessor';
import { IGrpcMethodFinder } from './IGrpcMethodFinder';
import { IGrpcRouteFinder } from './IGrpcRouteFinder';
import { IGrpcServerCallAccessor } from './IGrpcServerCallAccessor';
import { IGrpcStatusCodeMapper } from './IGrpcStatusCodeMapper';
import { ReflectionGrpcMethodFinder } from './ReflectionGrpcMethodFinder';
import { IGrpcMessageAdapter } from './Serialization/IGrpcMessageAdapter';
import { JsonGrpcMessageAdapter } from './Serialization/JsonGrpcMessageAdapter';

/**
 * Port of Benzene.Grpc.DependencyInjectionExtensions (C# extension method → free function).
 *
 * Registers the services required to route gRPC unary calls to message handlers: the method finder +
 * route finder (built once), the four boundary getters + header version getter, the result setter, the
 * message adapter and request mapper, the status-code mapper, the scoped server-call accessor, a `"grpc"`
 * `ITransportInfo`, and the per-context request/response items. Called automatically by `useGrpc`.
 *
 * Faithful to the .NET registration set. The `MessageRouter<GrpcContext>` and media-format services are
 * NOT registered here (as in .NET the gRPC request mapper is the bespoke {@link GrpcRequestMapper}, not the
 * negotiator-driven one) — `useMessageHandlers` adds the router when the pipeline is wired.
 */
export function addGrpcMessageHandlers(
  services: IBenzeneServiceContainer,
): IBenzeneServiceContainer {
  tryAddSingleton(services, IGrpcMethodFinder, ReflectionGrpcMethodFinder);
  tryAddSingleton(services, IGrpcRouteFinder, GrpcRouteFinder);

  services.addScopedFactory(
    IMessageTopicGetter,
    () => new GrpcMessageTopicGetter() as IMessageTopicGetter<unknown>,
  );
  addHeaderMessageVersionGetter<GrpcContext>(services);
  services.addScopedFactory(
    IMessageBodyGetter,
    () => new GrpcMessageBodyGetter() as IMessageBodyGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHeadersGetter,
    () => new GrpcMessageHeadersGetter() as IMessageHeadersGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHandlerResultSetter,
    () => new GrpcMessageHandlerResultSetter() as IMessageHandlerResultSetter<unknown>,
  );

  tryAddScoped(services, IGrpcMessageAdapter, JsonGrpcMessageAdapter);
  services.addScopedFactory(
    IRequestMapper,
    (resolver) =>
      new GrpcRequestMapper(resolver.getService(IGrpcMessageAdapter)) as IRequestMapper<unknown>,
  );

  tryAddSingleton(services, IGrpcStatusCodeMapper, DefaultGrpcStatusCodeMapper);

  services.addScoped(GrpcServerCallAccessor);
  services.addScopedFactory(IGrpcServerCallAccessor, (resolver) =>
    resolver.getService(GrpcServerCallAccessor),
  );

  services.addSingletonFactory(ITransportInfo, () => new TransportInfo(TransportNames.Grpc));
  addContextItems(services);
  return services;
}

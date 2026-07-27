import {
  IBenzeneServiceContainer,
  ILoggerFactory,
  NullLogger,
  tryAddScoped,
  tryAddSingleton,
  tryAddSingletonInstance,
} from '@benzene/abstractions';
import { IBenzeneMessageClient } from '@benzene/clients';
import { IGrpcMessageAdapter, JsonGrpcMessageAdapter } from '@benzene/grpc';
import { Client } from '@grpc/grpc-js';
import { DefaultGrpcStatusReverseMapper } from './DefaultGrpcStatusReverseMapper';
import { GrpcBenzeneMessageClient } from './GrpcBenzeneMessageClient';
import { GrpcClientRouteRegistry } from './GrpcClientRouteRegistry';
import { IGrpcClientRouteRegistry } from './IGrpcClientRouteRegistry';
import { IGrpcStatusReverseMapper } from './IGrpcStatusReverseMapper';

/**
 * Port of Benzene.Grpc.Client.DependencyInjectionExtensions (C# extension method → free function).
 *
 * Registers an {@link IBenzeneMessageClient} backed by gRPC. `configureRoutes` registers each outbound
 * RPC's topic + full method name (see {@link IGrpcClientRouteRegistry.add}). The route registry, the
 * JSON/structural message adapter, and the reverse status mapper are registered (only if not already
 * present), then a scoped `IBenzeneMessageClient` factory builds a {@link GrpcBenzeneMessageClient} over
 * the caller-supplied `client`.
 *
 * BEND (`GrpcChannel` from DI → caller-supplied grpc-js `Client`): .NET's `AddGrpcClient` resolves a
 * `GrpcChannel` from the container. The port takes the grpc-js `Client` explicitly — matching how callers
 * own their own `SQSClient`/`Producer`/`Channel` for the other outbound clients — so no channel is created
 * or owned here.
 *
 * DEFERRED (`healthCheck` parameter): .NET's `AddGrpcClient` auto-wires a `GrpcHealthCheck`. The
 * health-check domain is out of scope for this port (as it is for `@benzene/grpc`), so the parameter and
 * the auto-wiring are dropped.
 */
export function addGrpcClient(
  services: IBenzeneServiceContainer,
  client: Client,
  configureRoutes: (registry: IGrpcClientRouteRegistry) => void,
): IBenzeneServiceContainer {
  const routeRegistry = new GrpcClientRouteRegistry();
  configureRoutes(routeRegistry);

  tryAddSingletonInstance<IGrpcClientRouteRegistry>(services, IGrpcClientRouteRegistry, routeRegistry);
  tryAddScoped(services, IGrpcMessageAdapter, JsonGrpcMessageAdapter);
  tryAddSingleton(services, IGrpcStatusReverseMapper, DefaultGrpcStatusReverseMapper);

  services.addScopedFactory(
    IBenzeneMessageClient,
    (resolver) =>
      new GrpcBenzeneMessageClient(
        client,
        resolver.getService(IGrpcClientRouteRegistry),
        resolver.getService(IGrpcMessageAdapter),
        resolver.getService(IGrpcStatusReverseMapper),
        resolver.tryGetService(ILoggerFactory)?.createLogger('GrpcBenzeneMessageClient') ??
          NullLogger.instance,
        resolver,
      ),
  );

  return services;
}

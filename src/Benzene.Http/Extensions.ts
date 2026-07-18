import { IBenzeneServiceContainer, tryAddScopedFactory, tryAddSingletonFactory } from '@benzene/abstractions';
import { IMessageHandlersFinder } from '@benzene/abstractions-message-handlers';
import { DefaultHttpHeaderMappings } from './DefaultHttpHeaderMappings';
import { DefaultHttpStatusCodeMapper } from './DefaultHttpStatusCodeMapper';
import { IHttpHeaderMappings } from './IHttpHeaderMappings';
import { IHttpStatusCodeMapper } from './IHttpStatusCodeMapper';
import { CacheHttpEndpointFinder } from './Routing/CacheHttpEndpointFinder';
import { CompositeHttpEndpointFinder } from './Routing/CompositeHttpEndpointFinder';
import { DependencyHttpEndpointFinder } from './Routing/DependencyHttpEndpointFinder';
import { IHttpEndpointDefinition } from './Routing/IHttpEndpointDefinition';
import { IHttpEndpointFinder } from './Routing/IHttpEndpointFinder';
import { IListHttpEndpointFinder } from './Routing/IListHttpEndpointFinder';
import { IRouteFinder } from './Routing/IRouteFinder';
import { ListHttpEndpointFinder } from './Routing/ListHttpEndpointFinder';
import { RegistryHttpEndpointFinder } from './Routing/RegistryHttpEndpointFinder';
import { RouteFinder } from './Routing/RouteFinder';

/**
 * Registers HTTP message-handler infrastructure: endpoint finders (registry/list/dependency,
 * composed with caching), the route finder, the default status-code mapper, and the default header
 * mappings.
 * Port of Benzene.Http.Extensions.AddHttpMessageHandlers (C# extension method -> free function).
 *
 * DI-under-erasure notes: C# `TryAddSingleton<RegistryHttpEndpointFinder>()` etc. become
 * `tryAddSingletonFactory` under the class token (a class is its own identifier). The C#
 * `ReflectionHttpEndpointFinder` — which resolves `IMessageHandlersFinder` and reads handlers'
 * `HttpEndpointAttribute`s — maps to `RegistryHttpEndpointFinder`, resolving the same
 * `IMessageHandlersFinder` and reading `@httpEndpoint` metadata. `DependencyHttpEndpointFinder`
 * collects every registered `IHttpEndpointDefinition` via `getServices` (the port of the C#
 * `IEnumerable<IHttpEndpointDefinition>` ctor). `AsLowerCase` (a `HttpRequest` helper) is not needed
 * by the API Gateway path and is omitted.
 */
export function addHttpMessageHandlers(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  tryAddSingletonFactory(
    services,
    RegistryHttpEndpointFinder,
    (r) => new RegistryHttpEndpointFinder(r.getService(IMessageHandlersFinder)),
  );
  tryAddSingletonFactory(services, ListHttpEndpointFinder, () => new ListHttpEndpointFinder());
  tryAddSingletonFactory(
    services,
    DependencyHttpEndpointFinder,
    (r) => new DependencyHttpEndpointFinder(r.getServices(IHttpEndpointDefinition)),
  );
  tryAddSingletonFactory(services, IListHttpEndpointFinder, (r) =>
    r.getService(ListHttpEndpointFinder),
  );
  tryAddSingletonFactory(
    services,
    IHttpEndpointFinder,
    (r) =>
      new CompositeHttpEndpointFinder(
        new CacheHttpEndpointFinder(r.getService(RegistryHttpEndpointFinder)),
        r.getService(ListHttpEndpointFinder),
        r.getService(DependencyHttpEndpointFinder),
      ),
  );
  tryAddSingletonFactory(services, IRouteFinder, (r) => new RouteFinder(r.getService(IHttpEndpointFinder)));

  tryAddScopedFactory(services, IHttpStatusCodeMapper, () => new DefaultHttpStatusCodeMapper());
  tryAddScopedFactory(services, IHttpHeaderMappings, () => new DefaultHttpHeaderMappings());
  return services;
}

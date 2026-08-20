import { IBenzeneServiceContainer, tryAddScopedFactory, tryAddSingletonFactory } from '@benzenejs/abstractions';
import { IMessageHandlersFinder, IResponsePayloadMapper } from '@benzenejs/abstractions-message-handlers';
import { DefaultResponsePayloadMapper } from '@benzenejs/core-message-handlers';
import { DefaultHttpHeaderMappings } from './DefaultHttpHeaderMappings';
import { DefaultHttpStatusCodeMapper } from './DefaultHttpStatusCodeMapper';
import { IHttpHeaderMappings } from './IHttpHeaderMappings';
import { HttpProblemDetailsResponsePayloadMapper } from './HttpProblemDetailsResponsePayloadMapper';
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

/**
 * Wraps `TContext`'s response payload mapper with {@link HttpProblemDetailsResponsePayloadMapper},
 * so a failed result's problem document carries the numeric HTTP `status` member
 * (`docs/specification/wire-contracts.md` §1.3, §4.1).
 * Port of Benzene.Http.Extensions.UseHttpProblemDetailsStatus (C# extension method -> free function).
 *
 * Call this for every context an HTTP-facing transport serves requests on (Express, API Gateway
 * v1/v2, the Azure Functions HTTP trigger, ...) — a transport that only carries a `BenzeneMessage`
 * envelope (no real HTTP response line) must NOT call it for its envelope context, since the
 * envelope's inner problem body is transport-neutral and must never carry a fabricated HTTP status.
 *
 * DI-under-erasure notes: C# registers the closed `IResponsePayloadMapper<TContext>` service type,
 * and self-registers the wrapped default under its own concrete `DefaultResponsePayloadMapper<TContext>`
 * type so the decorator can resolve it. TypeScript has one erased token and no per-type token for a
 * class, so — exactly as `usePayloadVersionCasting` does — the default inner mapper is reconstructed
 * here rather than resolved. `tryAddScopedFactory` keeps C#'s `TryAddScoped` semantics: an
 * application's own earlier registration wins outright, and this registration in turn wins over the
 * plain default `useMessageHandlers`/`addContextItems` try-adds later.
 */
export function useHttpProblemDetailsStatus<TContext>(
  services: IBenzeneServiceContainer,
): IBenzeneServiceContainer {
  tryAddScopedFactory(
    services,
    IResponsePayloadMapper,
    (r) =>
      new HttpProblemDetailsResponsePayloadMapper<TContext>(
        new DefaultResponsePayloadMapper<TContext>(),
        r.getService(IHttpStatusCodeMapper),
      ) as unknown as IResponsePayloadMapper<unknown>,
  );
  return services;
}

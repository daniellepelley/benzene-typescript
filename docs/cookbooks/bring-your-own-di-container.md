# Bring Your Own DI Container

Understand how Benzene resolves services, and — if your team must back Benzene with a different
container — the two contracts you implement to do it.

## Problem statement

Your team standardises on a particular dependency-injection container — tsyringe, InversifyJS,
Awilix, TypeDI — and you want to know whether Benzene's handlers and middleware can register and
resolve through *that* container instead of the one Benzene ships.

Be clear on one thing up front: **the TypeScript port has no Microsoft.Extensions.DependencyInjection
to swap out.** The .NET version of this recipe is about replacing MS DI's `IServiceProvider` with
Lamar/DryIoc/Autofac via the host's provider factory. Node has no platform container, so Benzene
ships **its own** first-party container (`@benzenejs/dependencies`) and defines the whole DI surface as
a small set of interfaces in `@benzenejs/abstractions`. Those interfaces *are* the integration seam. In
practice you almost never need to replace the container — but if you do, this page shows exactly which
contracts to implement.

## How Benzene DI is layered

Three interfaces, all in `@benzenejs/abstractions`, make up the seam:

```
 configureServices((services) => …)         addBenzene(services), useMessageHandlers(app, …), your registrations
        │  register against
        ▼
 IBenzeneServiceContainer  ──createServiceResolverFactory()──▶  IServiceResolverFactory
                                                                        │  createScope()
                                                                        ▼
                                                                IServiceResolver  ──getService(id)──▶ handlers + middleware
```

- **`IBenzeneServiceContainer`** — the *registration* surface. `configureServices` hands you one;
  Benzene's own `addBenzene(services)` and every `use…` builder register their services through it.
- **`IServiceResolverFactory`** — built once at startup via `container.createServiceResolverFactory()`.
  It owns singletons and hands out scopes.
- **`IServiceResolver`** — a per-request/per-message **scope**. The pipeline calls `getService(id)` on
  it to construct handlers and middleware, then `dispose()`s it.

Every entry point follows the same shape (here `InlineAwsLambdaStartUp.build()`): create a container,
run your `configureServices` action against it, then pass `container.createServiceResolverFactory()`
to the entry point. Nothing downstream knows *which* container produced the factory — that is the
whole reason a replacement is possible.

## The default container

`DefaultBenzeneServiceContainer` (in `@benzenejs/dependencies`) is the container every entry point uses
unless you build one yourself. It is the counterpart of .NET's `MicrosoftBenzeneServiceContainer`, and
it deliberately mirrors Microsoft.Extensions.DependencyInjection semantics so ported code behaves the
same:

- **Three lifetimes** — `singleton` (one instance for the factory's lifetime), `scoped` (one per
  `createScope()`), `transient` (a new one per resolve).
- **Last-registration-wins** — `getService(id)` returns the *most recent* registration for an
  identifier; `getServices(id)` returns them all, in registration order.
- **Disposal** — scoped/transient instances with a `dispose()` method are disposed when the scope is
  disposed; singletons when the factory is disposed. Caller-provided instances (registered via
  `add…Instance`) are never disposed by the container.

You rarely construct it directly — `configureServices` gives you one — but you can, and the DI tests
do:

```ts
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';

const container = new DefaultBenzeneServiceContainer();
container.addSingleton(IGreeter, Greeter);

const factory = container.createServiceResolverFactory();
const scope = factory.createScope();
const greeter = scope.getService(IGreeter); // resolves Greeter
scope.dispose();
```

## The registration API

`IBenzeneServiceContainer` exposes one method per lifetime × registration style. Each returns the
container so calls chain, and each collapses the several C# generic overloads into a single method
(TypeScript can't overload on erased generics):

| Method | Registers |
| --- | --- |
| `addSingleton(Ctor)` / `addSingleton(token, Ctor)` | a class, constructed once and shared |
| `addSingletonFactory(token, (resolver) => T)` | a singleton built by a factory function |
| `addSingletonInstance(token, instance)` | an existing object as a singleton |
| `addScoped(Ctor)` / `addScoped(token, Ctor)` | a class, one instance per scope |
| `addScopedFactory(token, (resolver) => T)` | a scoped instance from a factory |
| `addScopedInstance(token, instance)` | an existing object, scoped |
| `addTransient(Ctor)` / `addTransient(token, Ctor)` | a class, new per resolve |
| `addTransientFactory(token, (resolver) => T)` | a transient from a factory |
| `addTransientInstance(token, instance)` | an existing object, transient |
| `isTypeRegistered(id)` | `true` if anything is registered for `id` |
| `addServiceResolver()` | makes `IServiceResolver` itself resolvable |
| `createServiceResolverFactory()` | builds the `IServiceResolverFactory` |

A factory registration receives the resolver, so a service can pull its own dependencies:

```ts
container.addScopedFactory(IOrderService, (resolver) =>
  new OrderService(resolver.getService(IOrderRepository)),
);
```

There is no `addSingleton`/`addScoped`/`addTransient` that *conditionally* skips an existing
registration on the interface itself. That is the job of the **`tryAdd…` free functions** in
`@benzenejs/abstractions` — `tryAddSingleton`, `tryAddScopedFactory`, `tryAddSingletonInstance`, and the
rest — which take the container as their first argument and register only if `isTypeRegistered(id)` is
false (the port of C#'s `TryAdd…` extension methods):

```ts
import { tryAddSingleton } from '@benzenejs/abstractions';

tryAddSingleton(services, IClock, SystemClock); // registers only if nothing else has claimed IClock
```

`addBenzene(services)` is built almost entirely out of `tryAdd…`, which is why your own explicit
`addSingleton(IClock, MyClock)` *before* `addBenzene` wins: `addBenzene` sees it registered and skips
its default. (And why registering a fake *after* the real service wins — last-registration-wins — the
technique in [Mocking External Dependencies](mocking-dependencies.md).)

## Service tokens and `static inject`

Two conventions make container resolution work under type erasure. Both are the port's answer to the
fact that TypeScript has no runtime `Type` and no reflective constructor injection.

**Service tokens.** An injected interface declares a merged `ServiceToken` constant of the same name,
built with `serviceToken<T>('Name')`. The constant is the runtime identifier the container keys on;
the interface is the compile-time type. A concrete class can be its own identifier (like `typeof(T)`
in C#):

```ts
import { ServiceToken, serviceToken } from '@benzenejs/abstractions';

export interface IOrderRepository {
  findAsync(id: string): Promise<Order | undefined>;
}

// Declaration merging: `IOrderRepository` is both the type and the runtime token.
export const IOrderRepository: ServiceToken<IOrderRepository> =
  serviceToken<IOrderRepository>('IOrderRepository');
```

**`static inject`.** Because parameter types are erased, a class declares its constructor
dependencies as a `static readonly inject = [...] as const` array of identifiers. The container
resolves each and passes them in order:

```ts
export class OrderService {
  static readonly inject = [IOrderRepository] as const;
  constructor(private readonly repository: IOrderRepository) {}
}

container.addScoped(IOrderService, OrderService); // repository resolved and injected
```

If a class declares constructor parameters but no `inject` array, the container throws a
`BenzeneException` naming the fix rather than silently constructing with `undefined` arguments — it
detects the mismatch via `Function.length`. This is the same convention handlers use; see
[Message Handlers](../message-handlers.md#imessagehandlertrequest-tresponse--imessagehandlernoresponsetrequest).

## Backing Benzene with an external container

If your team genuinely must route Benzene through, say, tsyringe or Awilix, you do it by implementing
the two runtime contracts — **not** by editing Benzene. An adapter has to supply:

1. an **`IBenzeneServiceContainer`**, so Benzene's own `addBenzene(services)` and every `use…` builder
   can register into your container; and
2. an **`IServiceResolverFactory`** whose `createScope()` returns an **`IServiceResolver`** the pipeline
   resolves handlers and middleware from.

The adapter is where you translate Benzene's model onto your container's API. To stay a drop-in, it
must preserve the four semantics the rest of Benzene assumes:

- **Three lifetimes** map onto your container's singleton/scoped/transient concepts.
- **Last-registration-wins** for `getService`, with `getServices` returning every registration.
- **`static inject` constructor injection** — your class factory reads `Ctor.inject` and resolves each
  identifier (external containers don't understand Benzene tokens, so *you* wire this).
- **`ServiceToken` / class as the key** — tokens are plain objects; use them as map keys directly.

The shape of an `IServiceResolver` adapter:

```ts
import {
  IServiceResolver,
  IServiceResolverFactory,
  ServiceIdentifier,
  serviceIdentifierName,
} from '@benzenejs/abstractions';

class ExternalContainerResolver implements IServiceResolver {
  constructor(private readonly scope: MyExternalScope) {} // your container's scope type

  getService<T>(identifier: ServiceIdentifier<T>): T {
    const service = this.tryGetService(identifier);
    if (service === undefined) {
      throw new Error(`Unable to resolve ${serviceIdentifierName(identifier)}`);
    }
    return service;
  }

  tryGetService<T>(identifier: ServiceIdentifier<T>): T | undefined {
    // Special-case the resolver so `getService(IServiceResolver)` returns `this`, exactly as the
    // default resolver does — some middleware resolves the scope itself.
    if ((identifier as unknown) === IServiceResolver) return this as unknown as T;
    return this.scope.tryResolve<T>(identifier); // your container, keyed on the token/class
  }

  getServices<T>(identifier: ServiceIdentifier<T>): T[] {
    return this.scope.resolveAll<T>(identifier);
  }

  dispose(): void {
    this.scope.dispose();
  }
}

class ExternalContainerFactory implements IServiceResolverFactory {
  constructor(private readonly container: MyExternalContainer) {}
  createScope(): IServiceResolver {
    return new ExternalContainerResolver(this.container.beginScope());
  }
  dispose(): void {
    this.container.dispose();
  }
}
```

The `IBenzeneServiceContainer` half maps each `add…` call onto your container's registration API,
implementing the class-factory + `static inject` resolution yourself (see
`DefaultBenzeneServiceContainer`'s `createClassFactory` in `@benzenejs/dependencies` for the reference
implementation to copy). `createServiceResolverFactory()` then returns your
`ExternalContainerFactory`.

Once the adapter exists, hand it to an entry point in place of the default. `InlineAwsLambdaStartUp`
constructs its own `DefaultBenzeneServiceContainer` internally and does not accept a foreign one, so a
custom-container setup means driving the pieces yourself — build the pipeline over your container and
pass its factory to the entry point directly, the same way `build()` does. That coupling is exactly
why swapping the container is rarely worth it: **the default container already implements MS DI
semantics faithfully, and every ported test and example runs on it.**

## Testing

Prove any container — default or adapter — resolves a real Benzene registration graph without standing
up a transport. Register through the container, build a scope, and resolve:

```ts
import { describe, expect, it } from 'vitest';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { addBenzene } from '@benzenejs/core-message-handlers';
import { ISerializer } from '@benzenejs/abstractions';

describe('container backs a Benzene registration graph', () => {
  it('resolves the baseline services addBenzene registers', () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container); // registers statuses, serializer, version selector, core middleware, …

    const scope = container.createServiceResolverFactory().createScope();

    // addBenzene registers the default JSON serializer — a good smoke test that resolution works.
    expect(scope.tryGetService(ISerializer)).toBeDefined();
    scope.dispose();
  });
});
```

Swap `DefaultBenzeneServiceContainer` for your adapter and the same assertions prove it is a valid
drop-in. To test the container end-to-end through a real pipeline (routing, binding, response
rendering), drive an entry point exactly as [Mocking External Dependencies](mocking-dependencies.md)
does — that recipe is the fuller worked example of registering into `configureServices` and running a
message through.

## Troubleshooting

### `BenzeneException: Unable to resolve '<name>'. Register it on the container before it is resolved …`

Nothing is registered for that identifier in the container used to build the factory. Confirm your
registration ran (in `configureServices`, and after `addBenzene`) and that you registered against the
**same token constant** the consumer injects — not a second `serviceToken('IFoo')` with the same
string. Two tokens with identical descriptions are still different objects and different map keys.

### `BenzeneException: … declares N constructor parameter(s) but no static \`inject\` array`

A class has constructor parameters but no `static inject`, so the container can't resolve them (types
are erased — there is no reflective injection). Add
`static readonly inject = [/* identifiers, in constructor order */] as const`.

### The wrong implementation resolves

`getService` returns the **last** registration for an identifier. If a default is winning over your
override, register yours *after* it; if your override is being ignored, it was probably registered
*before*. Use `getServices(id)` to see every registration for a token.

### An external-container adapter resolves nothing / resolves stale singletons

Your adapter isn't honouring one of the four semantics above — most often lifetimes (a "scoped"
registration built as a singleton) or last-registration-wins. Port
`DefaultServiceResolver`/`DefaultServiceResolverFactory` behaviour precisely; they are small and are
the reference contract.

## Trade-offs and variations

- **Prefer the default container.** It ships with the port, implements MS DI semantics, and every test
  and example exercises it. Replacing it means re-implementing lifetimes, last-registration-wins, and
  `static inject` injection — and keeping them correct as the library evolves.
- **A factory registration is usually enough.** If you reach for another container only to build one
  service in a bespoke way, `add…Factory(token, (resolver) => …)` already gives you full control over
  construction without leaving Benzene's container.
- **No native adapter packages (yet).** The .NET port ships `Benzene.Autofac`; there is no
  `@benzenejs/tsyringe`-style adapter in the TypeScript port. The seam is the three interfaces on this
  page — implement them if you need a specific container, and consider contributing the adapter back.

## Further reading

- [Hosting](../hosting.md) — how entry points and `configureServices` wire the pipeline and the
  container.
- [Message Handlers](../message-handlers.md) — the `static inject` convention and why handlers stay
  thin.
- [Mocking External Dependencies](mocking-dependencies.md) — registering fakes into `configureServices`
  and driving a real pipeline.
- [Testing Benzene](../testing-benzene.md) — the complete testing guide.

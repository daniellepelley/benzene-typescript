import { InjectableConstructor, ServiceIdentifier } from './ServiceToken';
import { IServiceResolver } from './IServiceResolver';
import { IServiceResolverFactory } from './IServiceResolverFactory';

/** Factory function creating a service instance from a resolver. Port of C# `Func<IServiceResolver, TImplementation>`. */
export type ServiceFactory<T> = (serviceResolver: IServiceResolver) => T;

/**
 * DI container abstraction for registering dependencies with different lifetimes.
 * Container-agnostic, allowing Benzene to work with any underlying container implementation.
 * Port of Benzene.Abstractions.DI.IBenzeneServiceContainer.
 *
 * C# overload mapping (TypeScript cannot overload on erased generics):
 * - `AddScoped<TImplementation>()`                 → `addScoped(Ctor)`
 * - `AddScoped<TService, TImplementation>()`       → `addScoped(token, Ctor)`
 * - `AddScoped<TImplementation>(implementation)`   → `addScopedInstance(identifier, instance)`
 * - `AddScoped<TImplementation>(func)`             → `addScopedFactory(identifier, factory)`
 * The `Type`-based (non-generic) overloads collapse into the same methods, since
 * TypeScript identifiers are already runtime values.
 */
export interface IBenzeneServiceContainer {
  /** Port of C# `IsTypeRegistered<TService>()` / `IsTypeRegistered(Type)`. */
  isTypeRegistered(identifier: ServiceIdentifier<unknown>): boolean;

  /** Registers a scoped service. A new instance is created once per scope. */
  addScoped<T>(implementation: InjectableConstructor<T>): IBenzeneServiceContainer;
  addScoped<T>(service: ServiceIdentifier<T>, implementation: InjectableConstructor<T>): IBenzeneServiceContainer;

  /** Registers a scoped service using a factory function. */
  addScopedFactory<T>(service: ServiceIdentifier<T>, factory: ServiceFactory<T>): IBenzeneServiceContainer;

  /** Registers a scoped service using an existing instance. */
  addScopedInstance<T>(service: ServiceIdentifier<T>, implementation: T): IBenzeneServiceContainer;

  /** Registers a transient service. A new instance is created each time the service is requested. */
  addTransient<T>(implementation: InjectableConstructor<T>): IBenzeneServiceContainer;
  addTransient<T>(service: ServiceIdentifier<T>, implementation: InjectableConstructor<T>): IBenzeneServiceContainer;

  /** Registers a transient service using a factory function. */
  addTransientFactory<T>(service: ServiceIdentifier<T>, factory: ServiceFactory<T>): IBenzeneServiceContainer;

  /** Registers a transient service using an existing instance. */
  addTransientInstance<T>(service: ServiceIdentifier<T>, implementation: T): IBenzeneServiceContainer;

  /** Registers a singleton service. A single instance is shared for the container's lifetime. */
  addSingleton<T>(implementation: InjectableConstructor<T>): IBenzeneServiceContainer;
  addSingleton<T>(service: ServiceIdentifier<T>, implementation: InjectableConstructor<T>): IBenzeneServiceContainer;

  /** Registers a singleton service using a factory function. */
  addSingletonFactory<T>(service: ServiceIdentifier<T>, factory: ServiceFactory<T>): IBenzeneServiceContainer;

  /** Registers a singleton service using an existing instance. */
  addSingletonInstance<T>(service: ServiceIdentifier<T>, implementation: T): IBenzeneServiceContainer;

  /** Port of C# `AddServiceResolver()`: makes `IServiceResolver` itself resolvable from the container. */
  addServiceResolver(): IBenzeneServiceContainer;

  /** Port of C# `CreateServiceResolverFactory()`. */
  createServiceResolverFactory(): IServiceResolverFactory;
}

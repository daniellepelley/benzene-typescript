import { InjectableConstructor, ServiceIdentifier } from './ServiceToken';
import { IBenzeneServiceContainer, ServiceFactory } from './IBenzeneServiceContainer';

/**
 * Conditional registration helpers that only register a service if it is not
 * already registered, preventing duplicate registrations.
 *
 * Port of Benzene.Abstractions.DI.BenzeneServiceContainerExtensions. C# extension
 * methods become free functions in TypeScript; each returns the container for chaining.
 */

export function tryAddScoped<T>(
  source: IBenzeneServiceContainer,
  service: ServiceIdentifier<T> | InjectableConstructor<T>,
  implementation?: InjectableConstructor<T>,
): IBenzeneServiceContainer {
  if (source.isTypeRegistered(service)) {
    return source;
  }
  return implementation === undefined
    ? source.addScoped(service as InjectableConstructor<T>)
    : source.addScoped(service, implementation);
}

export function tryAddScopedFactory<T>(
  source: IBenzeneServiceContainer,
  service: ServiceIdentifier<T>,
  factory: ServiceFactory<T>,
): IBenzeneServiceContainer {
  return source.isTypeRegistered(service) ? source : source.addScopedFactory(service, factory);
}

export function tryAddScopedInstance<T>(
  source: IBenzeneServiceContainer,
  service: ServiceIdentifier<T>,
  implementation: T,
): IBenzeneServiceContainer {
  return source.isTypeRegistered(service) ? source : source.addScopedInstance(service, implementation);
}

export function tryAddTransient<T>(
  source: IBenzeneServiceContainer,
  service: ServiceIdentifier<T> | InjectableConstructor<T>,
  implementation?: InjectableConstructor<T>,
): IBenzeneServiceContainer {
  if (source.isTypeRegistered(service)) {
    return source;
  }
  return implementation === undefined
    ? source.addTransient(service as InjectableConstructor<T>)
    : source.addTransient(service, implementation);
}

export function tryAddTransientFactory<T>(
  source: IBenzeneServiceContainer,
  service: ServiceIdentifier<T>,
  factory: ServiceFactory<T>,
): IBenzeneServiceContainer {
  return source.isTypeRegistered(service) ? source : source.addTransientFactory(service, factory);
}

export function tryAddTransientInstance<T>(
  source: IBenzeneServiceContainer,
  service: ServiceIdentifier<T>,
  implementation: T,
): IBenzeneServiceContainer {
  return source.isTypeRegistered(service) ? source : source.addTransientInstance(service, implementation);
}

export function tryAddSingleton<T>(
  source: IBenzeneServiceContainer,
  service: ServiceIdentifier<T> | InjectableConstructor<T>,
  implementation?: InjectableConstructor<T>,
): IBenzeneServiceContainer {
  if (source.isTypeRegistered(service)) {
    return source;
  }
  return implementation === undefined
    ? source.addSingleton(service as InjectableConstructor<T>)
    : source.addSingleton(service, implementation);
}

export function tryAddSingletonFactory<T>(
  source: IBenzeneServiceContainer,
  service: ServiceIdentifier<T>,
  factory: ServiceFactory<T>,
): IBenzeneServiceContainer {
  return source.isTypeRegistered(service) ? source : source.addSingletonFactory(service, factory);
}

export function tryAddSingletonInstance<T>(
  source: IBenzeneServiceContainer,
  service: ServiceIdentifier<T>,
  implementation: T,
): IBenzeneServiceContainer {
  return source.isTypeRegistered(service) ? source : source.addSingletonInstance(service, implementation);
}

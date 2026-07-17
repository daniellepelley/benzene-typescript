import { ServiceIdentifier, ServiceToken, serviceToken } from './ServiceToken';

/**
 * Resolves services from the dependency injection container within a scope.
 * Port of Benzene.Abstractions.DI.IServiceResolver (C# `IServiceResolver : IDisposable`).
 */
export interface IServiceResolver {
  /**
   * Resolves a required service. Throws if the service is not registered.
   * Port of C# `T GetService<T>()`.
   */
  getService<T>(identifier: ServiceIdentifier<T>): T;

  /**
   * Attempts to resolve a service, returning `undefined` when it is not registered.
   * Port of C# `T? TryGetService<T>()` (C# `null` maps to `undefined`).
   */
  tryGetService<T>(identifier: ServiceIdentifier<T>): T | undefined;

  /**
   * Resolves all registrations for a service.
   * Port of C# `IEnumerable<T>` constructor injection, which has no direct
   * TypeScript equivalent as an identifier type.
   */
  getServices<T>(identifier: ServiceIdentifier<T>): T[];

  /** Port of C# `IDisposable.Dispose()`; releases the scope and any scoped instances. */
  dispose(): void;
}

export const IServiceResolver: ServiceToken<IServiceResolver> =
  serviceToken<IServiceResolver>('IServiceResolver');

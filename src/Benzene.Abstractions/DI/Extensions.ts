import { ServiceIdentifier } from './ServiceToken';
import { IServiceResolver } from './IServiceResolver';

/**
 * Convenience helpers for IServiceResolver.
 * Port of Benzene.Abstractions.DI.Extensions (C# extension methods become free functions).
 */

/** Resolves a required service. Alias for `getService`. */
export function resolve<T>(source: IServiceResolver, identifier: ServiceIdentifier<T>): T {
  return source.getService(identifier);
}

/** Attempts to resolve a service. Alias for `tryGetService`. */
export function tryResolve<T>(source: IServiceResolver, identifier: ServiceIdentifier<T>): T | undefined {
  return source.tryGetService(identifier);
}

import { ServiceToken, serviceToken } from './ServiceToken';
import { IServiceResolver } from './IServiceResolver';

/**
 * Creates scoped service resolvers.
 * Port of Benzene.Abstractions.DI.IServiceResolverFactory.
 */
export interface IServiceResolverFactory {
  /** Creates a new dependency injection scope. */
  createScope(): IServiceResolver;

  /** Port of C# `IDisposable.Dispose()`. */
  dispose(): void;
}

export const IServiceResolverFactory: ServiceToken<IServiceResolverFactory> =
  serviceToken<IServiceResolverFactory>('IServiceResolverFactory');

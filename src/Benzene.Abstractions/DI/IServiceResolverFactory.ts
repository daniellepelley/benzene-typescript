import { ServiceToken, serviceToken } from './ServiceToken';
import { IServiceResolver } from './IServiceResolver';

/**
 * Creates scoped service resolvers.
 * Port of Benzene.Abstractions.DI.IServiceResolverFactory.
 */
export interface IServiceResolverFactory {
  /** Creates a new dependency injection scope. */
  createScope(): IServiceResolver;

  /** Port of C# `IDisposable.Dispose()`; releases synchronously-disposable singletons. */
  dispose(): void;

  /**
   * Port of C# `IAsyncDisposable.DisposeAsync()`; awaits async-disposable singletons at shutdown.
   * Optional, mirroring .NET (the interface is `IDisposable`; async disposal is feature-detected).
   * Benzene's built-in factories implement it; external DI adapters need not.
   */
  disposeAsync?(): Promise<void>;
}

export const IServiceResolverFactory: ServiceToken<IServiceResolverFactory> =
  serviceToken<IServiceResolverFactory>('IServiceResolverFactory');

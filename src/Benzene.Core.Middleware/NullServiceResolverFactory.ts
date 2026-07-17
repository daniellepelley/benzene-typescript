import { IServiceResolver, IServiceResolverFactory } from '@benzene/abstractions';
import { NullServiceResolver } from './NullServiceResolver';

/**
 * Null-object resolver factory.
 * Port of Benzene.Core.Middleware.NullServiceResolverFactory.
 */
export class NullServiceResolverFactory implements IServiceResolverFactory {
  createScope(): IServiceResolver {
    return new NullServiceResolver();
  }

  dispose(): void {}
}

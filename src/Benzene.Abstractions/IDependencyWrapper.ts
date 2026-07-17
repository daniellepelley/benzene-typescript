import { IServiceResolver } from './DI/IServiceResolver';

/**
 * Wraps a resolved dependency with additional behavior (decorator pattern).
 * Port of Benzene.Abstractions.IDependencyWrapper&lt;T&gt;.
 */
export interface IDependencyWrapper<T> {
  wrap(serviceResolver: IServiceResolver, source: T): T;
}

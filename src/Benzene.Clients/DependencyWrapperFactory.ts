import { IDependencyWrapper, IServiceResolver } from '@benzene/abstractions';

/**
 * Port of Benzene.Clients.DependencyWrapperFactory&lt;T&gt;.
 *
 * Applies an ordered chain of `IDependencyWrapper<T>` decorators to a source instance. C#'s
 * `Aggregate(source, (m, wrapper) => wrapper.Wrap(resolver, m))` folds the wrappers left-to-right,
 * so the first wrapper added is the innermost (closest to `source`) and the last wrapper added is
 * the outermost — its `wrap` runs first on the way in.
 */
export class DependencyWrapperFactory<T> {
  constructor(private readonly dependencyWrappers: readonly IDependencyWrapper<T>[]) {}

  create(serviceResolver: IServiceResolver, source: T): T {
    return this.dependencyWrappers.reduce(
      (current, wrapper) => wrapper.wrap(serviceResolver, current),
      source,
    );
  }
}

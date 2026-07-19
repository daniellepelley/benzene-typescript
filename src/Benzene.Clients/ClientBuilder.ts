import { IDependencyWrapper, IServiceResolver } from '@benzene/abstractions';
import { IBenzeneMessageClient } from './IBenzeneMessageClient';
import { DependencyWrapperFactory } from './DependencyWrapperFactory';

/**
 * Port of Benzene.Clients.ClientBuilder.
 *
 * Builds a decorated `IBenzeneMessageClient`: a base builder function produces the innermost client,
 * and each `withDependencyWrapper` adds an `IDependencyWrapper<IBenzeneMessageClient>` to the chain.
 * `build` resolves the base client then folds the wrappers over it via `DependencyWrapperFactory`
 * (first-added = innermost). C# `Func<IServiceResolver, IBenzeneMessageClient>` maps to
 * `(resolver) => IBenzeneMessageClient`.
 */
export class ClientBuilder {
  private readonly dependencyWrappers: IDependencyWrapper<IBenzeneMessageClient>[] = [];

  constructor(private readonly builder: (serviceResolver: IServiceResolver) => IBenzeneMessageClient) {}

  withDependencyWrapper(dependencyWrapper: IDependencyWrapper<IBenzeneMessageClient>): ClientBuilder {
    this.dependencyWrappers.push(dependencyWrapper);
    return this;
  }

  build(serviceResolver: IServiceResolver): IBenzeneMessageClient {
    const factory = new DependencyWrapperFactory<IBenzeneMessageClient>(this.dependencyWrappers);
    return factory.create(serviceResolver, this.builder(serviceResolver));
  }
}

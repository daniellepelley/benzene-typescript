import { IServiceResolver, IServiceResolverFactory } from '@benzene/abstractions';
import { DefaultServiceResolver } from './DefaultServiceResolver';
import { ServiceCollection, ServiceDescriptor } from './ServiceCollection';

interface Disposable {
  dispose(): void;
}

/**
 * Creates scopes over a ServiceCollection, owning the singleton instances.
 * Counterpart of Benzene.Microsoft.Dependencies.MicrosoftServiceResolverFactory.
 */
export class DefaultServiceResolverFactory implements IServiceResolverFactory {
  private readonly singletonInstances = new Map<ServiceDescriptor, unknown>();
  private readonly singletonDisposables: Disposable[] = [];

  constructor(private readonly services: ServiceCollection) {}

  createScope(): IServiceResolver {
    return new DefaultServiceResolver(
      this.services,
      this.singletonInstances,
      this.singletonDisposables,
      this,
    );
  }

  dispose(): void {
    for (const disposable of this.singletonDisposables) {
      disposable.dispose();
    }
    this.singletonDisposables.length = 0;
    this.singletonInstances.clear();
  }
}

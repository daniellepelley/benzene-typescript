import { IServiceResolver, IServiceResolverFactory } from '@benzene/abstractions';
import { DefaultServiceResolver } from './DefaultServiceResolver';
import { ServiceCollection, ServiceDescriptor } from './ServiceCollection';
import { disposeInstanceAsync, isDisposable } from './disposal';

/**
 * Creates scopes over a ServiceCollection, owning the singleton instances.
 * Counterpart of Benzene.Microsoft.Dependencies.MicrosoftServiceResolverFactory.
 */
export class DefaultServiceResolverFactory implements IServiceResolverFactory {
  private readonly singletonInstances = new Map<ServiceDescriptor, unknown>();
  private readonly singletonDisposables: unknown[] = [];

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
    // Synchronous teardown only; async-disposable singletons are released by disposeAsync().
    for (let i = this.singletonDisposables.length - 1; i >= 0; i--) {
      const instance = this.singletonDisposables[i];
      if (isDisposable(instance)) {
        instance.dispose();
      }
    }
    this.singletonDisposables.length = 0;
    this.singletonInstances.clear();
  }

  async disposeAsync(): Promise<void> {
    for (let i = this.singletonDisposables.length - 1; i >= 0; i--) {
      await disposeInstanceAsync(this.singletonDisposables[i]);
    }
    this.singletonDisposables.length = 0;
    this.singletonInstances.clear();
  }
}

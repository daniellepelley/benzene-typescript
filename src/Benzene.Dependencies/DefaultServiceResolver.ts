import {
  IServiceResolver,
  IServiceResolverFactory,
  ServiceIdentifier,
  serviceIdentifierName,
} from '@benzene/abstractions';
import { BenzeneException } from '@benzene/core';
import { ServiceCollection, ServiceDescriptor } from './ServiceCollection';
import { disposeInstanceAsync, isAnyDisposable, isDisposable } from './disposal';

/**
 * A dependency injection scope over a ServiceCollection.
 * Counterpart of Benzene.Microsoft.Dependencies.MicrosoftServiceResolverAdapter:
 * `IServiceResolver` and `IServiceResolverFactory` are special-cased the same way,
 * and unresolvable required services throw a BenzeneException.
 */
export class DefaultServiceResolver implements IServiceResolver {
  private readonly scopedInstances = new Map<ServiceDescriptor, unknown>();
  // Disposal candidates in creation order (sync- and/or async-disposable). Disposed in reverse (LIFO)
  // by disposeAsync so a resource is torn down before the ones it was built from.
  private readonly disposables: unknown[] = [];
  private disposed = false;

  constructor(
    private readonly services: ServiceCollection,
    private readonly singletonInstances: Map<ServiceDescriptor, unknown>,
    private readonly singletonDisposables: unknown[],
    private readonly factory: IServiceResolverFactory,
  ) {}

  getService<T>(identifier: ServiceIdentifier<T>): T {
    const service = this.tryGetService(identifier);
    if (service === undefined) {
      throw new BenzeneException(`Unable to resolve type ${serviceIdentifierName(identifier)}`);
    }
    return service;
  }

  tryGetService<T>(identifier: ServiceIdentifier<T>): T | undefined {
    if ((identifier as unknown) === IServiceResolver) {
      return this as unknown as T;
    }

    if ((identifier as unknown) === IServiceResolverFactory) {
      return this.factory as unknown as T;
    }

    const descriptors = this.services.getDescriptors(identifier);
    if (descriptors.length === 0) {
      return undefined;
    }

    // Multiple registrations resolve to the most recent one, matching
    // Microsoft.Extensions.DependencyInjection semantics.
    return this.resolveDescriptor(descriptors[descriptors.length - 1]) as T;
  }

  getServices<T>(identifier: ServiceIdentifier<T>): T[] {
    return this.services
      .getDescriptors(identifier)
      .map((descriptor) => this.resolveDescriptor(descriptor) as T);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    // Synchronous teardown only. An async-only disposable (e.g. a scoped Unit of Work that commits a
    // transaction) cannot be awaited here — use disposeAsync() to release those. Reverse (LIFO) order.
    for (let i = this.disposables.length - 1; i >= 0; i--) {
      const instance = this.disposables[i];
      if (isDisposable(instance)) {
        instance.dispose();
      }
    }
    this.disposables.length = 0;
    this.scopedInstances.clear();
  }

  async disposeAsync(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    // Reverse (LIFO) order, awaiting each async disposer, so a scoped transaction commits/rolls back
    // at scope end. Port of C# `await using`/`IAsyncDisposable`.
    for (let i = this.disposables.length - 1; i >= 0; i--) {
      await disposeInstanceAsync(this.disposables[i]);
    }
    this.disposables.length = 0;
    this.scopedInstances.clear();
  }

  private resolveDescriptor(descriptor: ServiceDescriptor): unknown {
    switch (descriptor.lifetime) {
      case 'singleton': {
        if (this.singletonInstances.has(descriptor)) {
          return this.singletonInstances.get(descriptor);
        }
        const instance = descriptor.factory(this);
        this.singletonInstances.set(descriptor, instance);
        if (!descriptor.isExternalInstance && isAnyDisposable(instance)) {
          this.singletonDisposables.push(instance);
        }
        return instance;
      }
      case 'scoped': {
        if (this.scopedInstances.has(descriptor)) {
          return this.scopedInstances.get(descriptor);
        }
        const instance = descriptor.factory(this);
        this.scopedInstances.set(descriptor, instance);
        this.trackDisposable(descriptor, instance);
        return instance;
      }
      case 'transient': {
        const instance = descriptor.factory(this);
        this.trackDisposable(descriptor, instance);
        return instance;
      }
    }
  }

  private trackDisposable(descriptor: ServiceDescriptor, instance: unknown): void {
    if (!descriptor.isExternalInstance && instance !== this && isAnyDisposable(instance)) {
      this.disposables.push(instance);
    }
  }
}

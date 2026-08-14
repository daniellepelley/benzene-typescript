import {
  IServiceResolver,
  IServiceResolverFactory,
  ServiceIdentifier,
  serviceIdentifierName,
} from '@benzenejs/abstractions';
import { BenzeneException } from '@benzenejs/core';
import { ServiceCollection, ServiceDescriptor } from './ServiceCollection';
import { disposeInstanceAsync, isAnyDisposable, isAsyncDisposable, isDisposable } from './disposal';

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
  // Names of the singleton(s) whose factory is currently executing (a stack for nested singleton
  // construction). Non-empty means "a singleton is being built right now", so a scoped service resolved
  // during that window is a captive-dependency footgun — see resolveDescriptor / warnCaptiveDependency.
  private readonly singletonConstructionStack: string[] = [];
  // Dedupes the captive-dependency warning so one bad (singleton -> scoped) pairing warns once, not on
  // every resolution.
  private readonly warnedCaptivePairs = new Set<string>();
  // Dedupes the async-only-skip warning so a synchronous dispose() that skips an async-only disposable
  // (e.g. a Unit of Work) warns once, not per skipped instance.
  private warnedAsyncSkip = false;

  constructor(
    private readonly services: ServiceCollection,
    private readonly singletonInstances: Map<ServiceDescriptor, unknown>,
    private readonly singletonDisposables: unknown[],
    private readonly factory: IServiceResolverFactory,
  ) {}

  getService<T>(identifier: ServiceIdentifier<T>): T {
    const service = this.tryGetService(identifier);
    if (service === undefined) {
      const name = serviceIdentifierName(identifier);
      throw new BenzeneException(
        `Unable to resolve '${name}'. Register it on the container before it is resolved ` +
          `(e.g. services.addSingleton(${name}, ...)), or check the 'static inject' list of the ` +
          `class that depends on it.`,
      );
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
    return this.resolveDescriptor(descriptors[descriptors.length - 1], identifier) as T;
  }

  getServices<T>(identifier: ServiceIdentifier<T>): T[] {
    return this.services
      .getDescriptors(identifier)
      .map((descriptor) => this.resolveDescriptor(descriptor, identifier) as T);
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
      } else if (isAsyncDisposable(instance)) {
        // Async-only disposable (no synchronous dispose()) — e.g. a scoped Unit of Work whose
        // commit/rollback is awaitable work. Synchronous dispose() cannot await it, so it is skipped
        // and its resource is NOT released here. Warn (once) so this isn't silent.
        this.warnAsyncOnlySkipped();
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

  private resolveDescriptor(
    descriptor: ServiceDescriptor,
    identifier?: ServiceIdentifier<unknown>,
  ): unknown {
    const name = identifier !== undefined ? serviceIdentifierName(identifier) : '<unknown service>';
    switch (descriptor.lifetime) {
      case 'singleton': {
        if (this.singletonInstances.has(descriptor)) {
          return this.singletonInstances.get(descriptor);
        }
        // Mark that this singleton's factory is running so any scoped service it resolves is caught as a
        // captive dependency. Pop in finally so a throwing factory still unwinds the flag (and — matching
        // the original — is not cached).
        this.singletonConstructionStack.push(name);
        let instance: unknown;
        try {
          instance = descriptor.factory(this);
        } finally {
          this.singletonConstructionStack.pop();
        }
        this.singletonInstances.set(descriptor, instance);
        if (!descriptor.isExternalInstance && isAnyDisposable(instance)) {
          this.singletonDisposables.push(instance);
        }
        return instance;
      }
      case 'scoped': {
        if (this.singletonConstructionStack.length > 0) {
          this.warnCaptiveDependency(
            this.singletonConstructionStack[this.singletonConstructionStack.length - 1],
            name,
          );
        }
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

  /**
   * Warns (once per offending pair) about the classic captive-dependency footgun: a `singleton` factory
   * resolving a `scoped` service. The scoped instance gets captured by the singleton and lives for the
   * app's lifetime, silently defeating its per-scope semantics (e.g. a per-request Unit of Work that
   * would then be shared across every request). Dev-time warning only — never throws, so it can't break
   * a running app.
   */
  private warnCaptiveDependency(singletonName: string, scopedName: string): void {
    const key = `${singletonName} -> ${scopedName}`;
    if (this.warnedCaptivePairs.has(key)) {
      return;
    }
    this.warnedCaptivePairs.add(key);
    console.warn(
      `Benzene DI captive dependency: singleton '${singletonName}' resolves scoped service ` +
        `'${scopedName}'. The scoped instance will be captured by the singleton and reused for the ` +
        `app's lifetime, defeating its per-scope semantics. Register '${singletonName}' as scoped/` +
        `transient, or resolve '${scopedName}' per operation from the scope instead of capturing it.`,
    );
  }

  /**
   * Warns (once) that a synchronous `dispose()` encountered an async-only disposable and skipped it,
   * leaving its resource unreleased. The classic case is a scoped Unit of Work whose commit/rollback is
   * awaitable work a synchronous teardown cannot express — tear the scope down with `disposeAsync()`
   * instead (which every migrated transport does per request). Dev-time warning only — never throws.
   */
  private warnAsyncOnlySkipped(): void {
    if (this.warnedAsyncSkip) {
      return;
    }
    this.warnedAsyncSkip = true;
    console.warn(
      "Benzene DI async-only disposable skipped: a scoped resource exposes only 'disposeAsync()' / " +
        "Symbol.asyncDispose (e.g. a Unit of Work) but the scope was torn down with synchronous " +
        "dispose(), which cannot await it — so it was NOT released. Use disposeAsync() to tear down " +
        'the scope so async-disposable resources can commit / roll back.',
    );
  }

  private trackDisposable(descriptor: ServiceDescriptor, instance: unknown): void {
    if (!descriptor.isExternalInstance && instance !== this && isAnyDisposable(instance)) {
      this.disposables.push(instance);
    }
  }
}

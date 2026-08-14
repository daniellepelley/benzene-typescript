import { afterEach, describe, expect, it, vi } from 'vitest';
import { IServiceResolver, serviceToken } from '@benzenejs/abstractions';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';

/**
 * The classic captive-dependency footgun: a `singleton` factory resolves a `scoped` service, capturing
 * that scoped instance for the app's lifetime. DefaultServiceResolver emits a dev-time console.warn when
 * it detects this (naming both services) — but never throws, so it stays non-breaking.
 */

class ScopedThing {}
class SingletonThing {
  constructor(readonly dependency: unknown) {}
}
class AnotherSingleton {}

const Scoped = serviceToken<ScopedThing>('ScopedThing');
const Singleton = serviceToken<SingletonThing>('SingletonThing');
const OtherSingleton = serviceToken<AnotherSingleton>('AnotherSingleton');
const SecondScoped = serviceToken<ScopedThing>('SecondScoped');

describe('DI captive-dependency validation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns (naming both services) when a singleton factory resolves a scoped service', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const container = new DefaultBenzeneServiceContainer();
    container.addScopedFactory(Scoped, () => new ScopedThing());
    container.addSingletonFactory(
      Singleton,
      (resolver: IServiceResolver) => new SingletonThing(resolver.getService(Scoped)),
    );

    const scope = container.createServiceResolverFactory().createScope();
    scope.getService(Singleton);

    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0][0] as string;
    expect(message).toContain('SingletonThing');
    expect(message).toContain('ScopedThing');
    expect(message.toLowerCase()).toContain('captive');
  });

  it('does NOT throw — resolution still succeeds when the footgun fires', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const container = new DefaultBenzeneServiceContainer();
    container.addScopedFactory(Scoped, () => new ScopedThing());
    container.addSingletonFactory(
      Singleton,
      (resolver: IServiceResolver) => new SingletonThing(resolver.getService(Scoped)),
    );

    const scope = container.createServiceResolverFactory().createScope();
    const instance = scope.getService(Singleton);

    expect(instance).toBeInstanceOf(SingletonThing);
  });

  it('does NOT warn for singleton -> singleton', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const container = new DefaultBenzeneServiceContainer();
    container.addSingletonFactory(OtherSingleton, () => new AnotherSingleton());
    container.addSingletonFactory(
      Singleton,
      (resolver: IServiceResolver) => new SingletonThing(resolver.getService(OtherSingleton)),
    );

    const scope = container.createServiceResolverFactory().createScope();
    scope.getService(Singleton);

    expect(warn).not.toHaveBeenCalled();
  });

  it('does NOT warn for scoped -> scoped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const container = new DefaultBenzeneServiceContainer();
    container.addScopedFactory(SecondScoped, () => new ScopedThing());
    container.addScopedFactory(
      Scoped,
      (resolver: IServiceResolver) => {
        resolver.getService(SecondScoped);
        return new ScopedThing();
      },
    );

    const scope = container.createServiceResolverFactory().createScope();
    scope.getService(Scoped);

    expect(warn).not.toHaveBeenCalled();
  });

  it('warns only once for the same offending pair across repeated resolutions', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const container = new DefaultBenzeneServiceContainer();
    container.addScopedFactory(Scoped, () => new ScopedThing());
    container.addSingletonFactory(
      Singleton,
      (resolver: IServiceResolver) => {
        // Resolve the scoped service twice inside the singleton factory.
        resolver.getService(Scoped);
        return new SingletonThing(resolver.getService(Scoped));
      },
    );

    const scope = container.createServiceResolverFactory().createScope();
    scope.getService(Singleton);
    scope.getService(Singleton); // cached — factory does not re-run

    expect(warn).toHaveBeenCalledTimes(1);
  });
});

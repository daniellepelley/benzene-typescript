import { describe, expect, it } from 'vitest';
import {
  IServiceResolver,
  IServiceResolverFactory,
  serviceToken,
  tryAddSingletonInstance,
} from '@benzene/abstractions';
import { BenzeneException } from '@benzene/core';
import { DefaultBenzeneServiceContainer, ServiceCollection } from '@benzene/dependencies';

/**
 * Tests for the first-party container in Benzene.Dependencies, the TypeScript
 * counterpart of Benzene.Microsoft.Dependencies.
 */
interface IGreeter {
  greet(): string;
}
const IGreeter = serviceToken<IGreeter>('IGreeter');

class Greeter implements IGreeter {
  static instances = 0;

  constructor() {
    Greeter.instances += 1;
  }

  greet(): string {
    return 'hello';
  }
}

class GreeterConsumer {
  static readonly inject = [IGreeter] as const;

  constructor(public readonly greeter: IGreeter) {}
}

describe('DefaultBenzeneServiceContainer', () => {
  it('Singleton_IsSharedAcrossScopes', () => {
    Greeter.instances = 0;
    const container = new DefaultBenzeneServiceContainer();
    container.addSingleton(IGreeter, Greeter);

    const factory = container.createServiceResolverFactory();
    const scope1 = factory.createScope();
    const scope2 = factory.createScope();

    expect(scope1.getService(IGreeter)).toBe(scope2.getService(IGreeter));
    expect(Greeter.instances).toBe(1);
  });

  it('Scoped_IsSharedWithinScope_NewPerScope', () => {
    Greeter.instances = 0;
    const container = new DefaultBenzeneServiceContainer();
    container.addScoped(IGreeter, Greeter);

    const factory = container.createServiceResolverFactory();
    const scope1 = factory.createScope();
    const scope2 = factory.createScope();

    expect(scope1.getService(IGreeter)).toBe(scope1.getService(IGreeter));
    expect(scope1.getService(IGreeter)).not.toBe(scope2.getService(IGreeter));
    expect(Greeter.instances).toBe(2);
  });

  it('Transient_IsNewPerResolution', () => {
    Greeter.instances = 0;
    const container = new DefaultBenzeneServiceContainer();
    container.addTransient(IGreeter, Greeter);

    const scope = container.createServiceResolverFactory().createScope();
    expect(scope.getService(IGreeter)).not.toBe(scope.getService(IGreeter));
    expect(Greeter.instances).toBe(2);
  });

  it('ConstructorInjection_ResolvesStaticInjectList', () => {
    const container = new DefaultBenzeneServiceContainer();
    container.addSingleton(IGreeter, Greeter);
    container.addSingleton(GreeterConsumer);

    const scope = container.createServiceResolverFactory().createScope();
    const consumer = scope.getService(GreeterConsumer);

    expect(consumer.greeter.greet()).toBe('hello');
  });

  it('GetService_Unregistered_ThrowsBenzeneException', () => {
    const container = new DefaultBenzeneServiceContainer();
    const scope = container.createServiceResolverFactory().createScope();

    expect(() => scope.getService(IGreeter)).toThrow(BenzeneException);
    expect(scope.tryGetService(IGreeter)).toBeUndefined();
  });

  it('GetServices_ReturnsAllRegistrations_GetServiceReturnsLast', () => {
    const container = new DefaultBenzeneServiceContainer();
    container.addSingletonInstance(IGreeter, { greet: () => 'first' });
    container.addSingletonInstance(IGreeter, { greet: () => 'second' });

    const scope = container.createServiceResolverFactory().createScope();

    expect(scope.getServices(IGreeter).map((x) => x.greet())).toEqual(['first', 'second']);
    expect(scope.getService(IGreeter).greet()).toBe('second');
  });

  it('TryAdd_DoesNotOverrideExistingRegistration', () => {
    const container = new DefaultBenzeneServiceContainer();
    container.addSingletonInstance(IGreeter, { greet: () => 'original' });
    tryAddSingletonInstance(container, IGreeter, { greet: () => 'override' });

    const scope = container.createServiceResolverFactory().createScope();
    expect(scope.getService(IGreeter).greet()).toBe('original');
  });

  it('Resolver_SpecialCases_ResolverAndFactory', () => {
    const services = new ServiceCollection();
    const container = new DefaultBenzeneServiceContainer(services);
    container.addServiceResolver();

    const factory = container.createServiceResolverFactory();
    const scope = factory.createScope();

    expect(scope.getService(IServiceResolver)).toBe(scope);
    expect(scope.getService(IServiceResolverFactory)).toBe(factory);
  });

  it('Dispose_DisposesScopedInstances', () => {
    const disposed: string[] = [];

    class DisposableService {
      dispose(): void {
        disposed.push('scoped');
      }
    }

    const container = new DefaultBenzeneServiceContainer();
    container.addScoped(DisposableService);

    const scope = container.createServiceResolverFactory().createScope();
    scope.getService(DisposableService);
    scope.dispose();

    expect(disposed).toEqual(['scoped']);
  });
});

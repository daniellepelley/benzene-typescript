import {
  IBenzeneServiceContainer,
  IServiceResolver,
  IServiceResolverFactory,
  InjectableConstructor,
  ServiceFactory,
  ServiceIdentifier,
} from '@benzene/abstractions';
import { BenzeneException } from '@benzene/core';
import { DefaultServiceResolverFactory } from './DefaultServiceResolverFactory';
import { ServiceCollection, ServiceLifetime } from './ServiceCollection';

/**
 * IBenzeneServiceContainer implementation over a ServiceCollection.
 * Counterpart of Benzene.Microsoft.Dependencies.MicrosoftBenzeneServiceContainer.
 *
 * Classes registered by constructor are instantiated with the identifiers listed
 * in their static `inject` array resolved and passed as constructor arguments —
 * the port of C# constructor injection (see InjectableConstructor).
 */
export class DefaultBenzeneServiceContainer implements IBenzeneServiceContainer {
  constructor(private readonly services: ServiceCollection = new ServiceCollection()) {}

  isTypeRegistered(identifier: ServiceIdentifier<unknown>): boolean {
    return this.services.has(identifier);
  }

  addScoped<T>(implementation: InjectableConstructor<T>): IBenzeneServiceContainer;
  addScoped<T>(service: ServiceIdentifier<T>, implementation: InjectableConstructor<T>): IBenzeneServiceContainer;
  addScoped<T>(
    serviceOrImplementation: ServiceIdentifier<T> | InjectableConstructor<T>,
    implementation?: InjectableConstructor<T>,
  ): IBenzeneServiceContainer {
    return this.addConstructor('scoped', serviceOrImplementation, implementation);
  }

  addScopedFactory<T>(service: ServiceIdentifier<T>, factory: ServiceFactory<T>): IBenzeneServiceContainer {
    return this.addDescriptor(service, 'scoped', factory, false);
  }

  addScopedInstance<T>(service: ServiceIdentifier<T>, implementation: T): IBenzeneServiceContainer {
    return this.addDescriptor(service, 'scoped', () => implementation, true);
  }

  addTransient<T>(implementation: InjectableConstructor<T>): IBenzeneServiceContainer;
  addTransient<T>(service: ServiceIdentifier<T>, implementation: InjectableConstructor<T>): IBenzeneServiceContainer;
  addTransient<T>(
    serviceOrImplementation: ServiceIdentifier<T> | InjectableConstructor<T>,
    implementation?: InjectableConstructor<T>,
  ): IBenzeneServiceContainer {
    return this.addConstructor('transient', serviceOrImplementation, implementation);
  }

  addTransientFactory<T>(service: ServiceIdentifier<T>, factory: ServiceFactory<T>): IBenzeneServiceContainer {
    return this.addDescriptor(service, 'transient', factory, false);
  }

  addTransientInstance<T>(service: ServiceIdentifier<T>, implementation: T): IBenzeneServiceContainer {
    return this.addDescriptor(service, 'transient', () => implementation, true);
  }

  addSingleton<T>(implementation: InjectableConstructor<T>): IBenzeneServiceContainer;
  addSingleton<T>(service: ServiceIdentifier<T>, implementation: InjectableConstructor<T>): IBenzeneServiceContainer;
  addSingleton<T>(
    serviceOrImplementation: ServiceIdentifier<T> | InjectableConstructor<T>,
    implementation?: InjectableConstructor<T>,
  ): IBenzeneServiceContainer {
    return this.addConstructor('singleton', serviceOrImplementation, implementation);
  }

  addSingletonFactory<T>(service: ServiceIdentifier<T>, factory: ServiceFactory<T>): IBenzeneServiceContainer {
    return this.addDescriptor(service, 'singleton', factory, false);
  }

  addSingletonInstance<T>(service: ServiceIdentifier<T>, implementation: T): IBenzeneServiceContainer {
    return this.addDescriptor(service, 'singleton', () => implementation, true);
  }

  addServiceResolver(): IBenzeneServiceContainer {
    // Port of C# `TryAddTransient<IServiceResolver>(...)`: the resolver resolves
    // itself, which DefaultServiceResolver also special-cases directly.
    if (!this.services.has(IServiceResolver)) {
      this.addDescriptor(IServiceResolver, 'transient', (resolver) => resolver, true);
    }
    return this;
  }

  createServiceResolverFactory(): IServiceResolverFactory {
    return new DefaultServiceResolverFactory(this.services);
  }

  private addConstructor<T>(
    lifetime: ServiceLifetime,
    serviceOrImplementation: ServiceIdentifier<T> | InjectableConstructor<T>,
    implementation?: InjectableConstructor<T>,
  ): IBenzeneServiceContainer {
    const service = serviceOrImplementation;
    const ctor = implementation ?? (serviceOrImplementation as InjectableConstructor<T>);
    return this.addDescriptor(service, lifetime, createClassFactory(ctor), false);
  }

  private addDescriptor<T>(
    service: ServiceIdentifier<T>,
    lifetime: ServiceLifetime,
    factory: ServiceFactory<T>,
    isExternalInstance: boolean,
  ): IBenzeneServiceContainer {
    this.services.add(service, {
      lifetime,
      factory: (resolver) => factory(resolver),
      isExternalInstance,
    });
    return this;
  }
}

function createClassFactory<T>(ctor: InjectableConstructor<T>): ServiceFactory<T> {
  return (resolver) => {
    const inject = ctor.inject ?? [];
    // TypeScript erases constructor parameter types, so — unlike .NET's reflective constructor
    // injection — the container can only pass what `static inject` lists. A class that declares
    // constructor parameters but forgets the `inject` array would otherwise be silently constructed
    // with zero args, failing far downstream as an `undefined` dependency. `Function.length` (the count
    // of leading non-defaulted parameters) lets us catch that here with an actionable message.
    if (inject.length === 0 && ctor.length > 0) {
      throw new BenzeneException(
        `${ctor.name || 'A registered class'} declares ${ctor.length} constructor parameter(s) but no ` +
          `static \`inject\` array, so the container cannot resolve them. Add ` +
          `\`static inject = [/* service identifiers */]\` to ${ctor.name || 'the class'} listing the ` +
          `dependencies to pass to its constructor.`,
      );
    }
    const args = inject.map((identifier) => resolver.getService(identifier));
    return new ctor(...(args as never[]));
  };
}

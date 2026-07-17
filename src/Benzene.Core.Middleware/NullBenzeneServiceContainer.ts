import { IBenzeneServiceContainer, IServiceResolverFactory } from '@benzene/abstractions';
import { NullServiceResolverFactory } from './NullServiceResolverFactory';

const notSupportedMessage =
  'NullBenzeneServiceContainer is a null-object placeholder and does not support service registration.';

/**
 * Null-object container: reports every type as registered (so `tryAdd` helpers
 * skip registration) and rejects direct registrations.
 * Port of Benzene.Core.Middleware.NullBenzeneServiceContainer.
 */
export class NullBenzeneServiceContainer implements IBenzeneServiceContainer {
  isTypeRegistered(): boolean {
    return true;
  }

  addScoped(): IBenzeneServiceContainer {
    throw new Error(notSupportedMessage);
  }

  addScopedFactory(): IBenzeneServiceContainer {
    throw new Error(notSupportedMessage);
  }

  addScopedInstance(): IBenzeneServiceContainer {
    throw new Error(notSupportedMessage);
  }

  addTransient(): IBenzeneServiceContainer {
    throw new Error(notSupportedMessage);
  }

  addTransientFactory(): IBenzeneServiceContainer {
    throw new Error(notSupportedMessage);
  }

  addTransientInstance(): IBenzeneServiceContainer {
    throw new Error(notSupportedMessage);
  }

  addSingleton(): IBenzeneServiceContainer {
    throw new Error(notSupportedMessage);
  }

  addSingletonFactory(): IBenzeneServiceContainer {
    throw new Error(notSupportedMessage);
  }

  addSingletonInstance(): IBenzeneServiceContainer {
    throw new Error(notSupportedMessage);
  }

  addServiceResolver(): IBenzeneServiceContainer {
    return this;
  }

  createServiceResolverFactory(): IServiceResolverFactory {
    return new NullServiceResolverFactory();
  }
}

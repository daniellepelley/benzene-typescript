import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { CompositeSecretStore } from './CompositeSecretStore';
import { ISecretStore } from './ISecretStore';
import { SecretResolver } from './SecretResolver';

/**
 * DI registration for a secret store. Registers the {@link ISecretStore} and a {@link SecretResolver}
 * over it as singletons, so handlers and startup code can resolve either.
 * Port of Benzene.Configuration.Core.Extensions (C# extension methods -> free functions taking the
 * container as the first argument).
 */

/** Registers `store` as the {@link ISecretStore}, plus a {@link SecretResolver} over it. */
export function addSecretStore(
  services: IBenzeneServiceContainer,
  store: ISecretStore,
): IBenzeneServiceContainer {
  services.addSingletonInstance(ISecretStore, store);
  services.addSingletonInstance(SecretResolver, new SecretResolver(store));
  return services;
}

/**
 * Registers an ordered {@link CompositeSecretStore} (first non-`undefined` wins) as the
 * {@link ISecretStore}, plus a {@link SecretResolver} over it.
 */
export function addSecretStores(
  services: IBenzeneServiceContainer,
  ...stores: ISecretStore[]
): IBenzeneServiceContainer {
  return addSecretStore(services, new CompositeSecretStore(...stores));
}

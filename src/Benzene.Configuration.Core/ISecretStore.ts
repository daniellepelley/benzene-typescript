import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * The neutral "fetch a named value from somewhere" seam that decouples an application from where its
 * secrets and configuration actually live. An app depends on this interface; a provider adapter
 * implements it (environment variables, a mounted file, Azure Key Vault, AWS Secrets Manager, ...), so
 * the same code runs against any backend and ports across clouds without change.
 * Port of Benzene.Configuration.Core.ISecretStore.
 *
 * Values may be secrets (a database password) or plain configuration (a service endpoint). One method
 * by design: a provider adapter is trivial to write, and composition ({@link CompositeSecretStore}),
 * caching ({@link CachingSecretStore}), validation, and typed resolution layer on top rather than being
 * pushed onto every adapter. C# `CancellationToken` maps to an optional `AbortSignal`.
 */
export interface ISecretStore {
  /**
   * Fetches the value for `name`, or `undefined` if this store does not have it (so a
   * {@link CompositeSecretStore} can fall through to the next store). C# `null` maps to `undefined`.
   */
  getSecretAsync(name: string, signal?: AbortSignal): Promise<string | undefined>;
}

export const ISecretStore: ServiceToken<ISecretStore> = serviceToken<ISecretStore>('ISecretStore');

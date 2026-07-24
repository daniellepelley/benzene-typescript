import { ISecretStore } from './ISecretStore';

/**
 * Tries an ordered list of stores and returns the first non-`undefined` value. Enables layering - e.g.
 * environment variables overriding a cloud store for local development, hard-coded defaults as a last
 * resort, or a fast in-process store in front of a remote one.
 * Port of Benzene.Configuration.Core.CompositeSecretStore.
 */
export class CompositeSecretStore implements ISecretStore {
  private readonly stores: readonly ISecretStore[];

  /** Initializes the composite from an ordered set of stores (earliest wins). */
  constructor(...stores: ISecretStore[]) {
    this.stores = stores;
  }

  async getSecretAsync(name: string, signal?: AbortSignal): Promise<string | undefined> {
    for (const store of this.stores) {
      const value = await store.getSecretAsync(name, signal);
      if (value !== undefined) {
        return value;
      }
    }

    return undefined;
  }
}

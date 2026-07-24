import { ISecretStore } from './ISecretStore';

/**
 * An in-process {@link ISecretStore} backed by a map - for tests, local development, and as the lowest
 * layer of a {@link CompositeSecretStore} (e.g. hard-coded local defaults).
 * Port of Benzene.Configuration.Core.InMemorySecretStore.
 */
export class InMemorySecretStore implements ISecretStore {
  private readonly values: ReadonlyMap<string, string>;

  /** Initializes a store from the given name/value pairs (empty if omitted). */
  constructor(values?: ReadonlyMap<string, string> | Readonly<Record<string, string>>) {
    if (values === undefined) {
      this.values = new Map();
    } else if (values instanceof Map) {
      this.values = values;
    } else {
      this.values = new Map(Object.entries(values as Record<string, string>));
    }
  }

  getSecretAsync(name: string): Promise<string | undefined> {
    return Promise.resolve(this.values.get(name));
  }
}

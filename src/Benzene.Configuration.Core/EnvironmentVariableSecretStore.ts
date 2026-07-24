import { ISecretStore } from './ISecretStore';

/**
 * An {@link ISecretStore} reading from environment variables - the twelve-factor default and the
 * natural local-development override in front of a cloud store. A logical name is mapped to an
 * environment-variable key by upper-casing it and replacing `:`, `.`, `-`, and spaces with `_` (so
 * `Db:Password` reads `DB_PASSWORD`), with an optional prefix.
 * Port of Benzene.Configuration.Core.EnvironmentVariableSecretStore.
 */
export class EnvironmentVariableSecretStore implements ISecretStore {
  private readonly prefix: string;

  /**
   * @param prefix An optional prefix prepended to every logical name before mapping (e.g. `MyApp:` so
   * `Db:Password` reads `MYAPP_DB_PASSWORD`). Defaults to none.
   */
  constructor(prefix = '') {
    this.prefix = prefix;
  }

  getSecretAsync(name: string): Promise<string | undefined> {
    const key = EnvironmentVariableSecretStore.toEnvironmentVariableKey(this.prefix + name);
    const value = process.env[key];
    return Promise.resolve(value === undefined || value === '' ? undefined : value);
  }

  /** Maps a logical name to an environment-variable key. */
  static toEnvironmentVariableKey(name: string): string {
    let result = '';
    for (const char of name) {
      result += char === ':' || char === '.' || char === '-' || char === ' ' ? '_' : char.toUpperCase();
    }
    return result;
  }
}

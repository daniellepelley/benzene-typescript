import { ISecretStore } from './ISecretStore';
import { MissingSecretException } from './MissingSecretException';

/**
 * Ergonomic, typed reads over an {@link ISecretStore} for building configuration at startup.
 * {@link requireAsync} throws {@link MissingSecretException} when a value is absent or blank (fail
 * fast); {@link getAsync} returns a default. The typed overloads parse and throw a clear error when a
 * present value is malformed.
 * Port of Benzene.Configuration.Core.SecretResolver.
 *
 * C#'s `FormatException` (no JS equivalent) maps to a plain `Error` with the same message; `Uri` maps
 * to the WHATWG `URL`.
 */
export class SecretResolver {
  private readonly store: ISecretStore;

  constructor(store: ISecretStore) {
    this.store = store;
  }

  /** Returns the value for `name`, throwing if it is absent or blank. */
  async requireAsync(name: string, signal?: AbortSignal): Promise<string> {
    const value = await this.store.getSecretAsync(name, signal);
    if (!isNonBlank(value)) {
      throw new MissingSecretException([name]);
    }

    return value;
  }

  /** Returns the value for `name`, or `defaultValue` if absent/blank. */
  async getAsync(
    name: string,
    defaultValue?: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const value = await this.store.getSecretAsync(name, signal);
    return isNonBlank(value) ? value : defaultValue;
  }

  /** Returns the value for `name` parsed as an integer. */
  async requireIntAsync(name: string, signal?: AbortSignal): Promise<number> {
    const value = await this.requireAsync(name, signal);
    const trimmed = value.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
      throw new Error(`Secret '${name}' is not a valid integer.`);
    }

    return Number(trimmed);
  }

  /** Returns the value for `name` parsed as a boolean. */
  async requireBoolAsync(name: string, signal?: AbortSignal): Promise<boolean> {
    const value = await this.requireAsync(name, signal);
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }

    throw new Error(`Secret '${name}' is not a valid boolean.`);
  }

  /** Returns the value for `name` parsed as an absolute URL. */
  async requireUriAsync(name: string, signal?: AbortSignal): Promise<URL> {
    const value = await this.requireAsync(name, signal);
    try {
      // The WHATWG URL constructor requires an absolute URL when called with a single argument.
      return new URL(value);
    } catch {
      throw new Error(`Secret '${name}' is not a valid absolute URI.`);
    }
  }
}

/** The inverse of C# `string.IsNullOrWhiteSpace`, narrowing `value` to a present, non-blank string. */
function isNonBlank(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

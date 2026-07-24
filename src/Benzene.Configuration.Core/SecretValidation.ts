import { ISecretStore } from './ISecretStore';
import { MissingSecretException } from './MissingSecretException';

/**
 * Startup fail-fast validation: verify every required secret resolves before the service starts
 * serving traffic, so a missing credential surfaces as an immediate, complete startup error rather than
 * a first-request failure deep in a handler.
 * Port of Benzene.Configuration.Core.SecretValidation (a C# static class -> a const object of free
 * functions). The C#'s `IEnumerable` and `params` overloads collapse into one variadic function.
 */
export const SecretValidation = {
  /**
   * Verifies every name in `requiredNames` resolves to a non-blank value, throwing
   * {@link MissingSecretException} listing *all* missing names at once.
   */
  async ensureRequiredAsync(store: ISecretStore, ...requiredNames: string[]): Promise<void> {
    const missing: string[] = [];
    for (const name of requiredNames) {
      const value = await store.getSecretAsync(name);
      if (value === undefined || value.trim() === '') {
        missing.push(name);
      }
    }

    if (missing.length > 0) {
      throw new MissingSecretException(missing);
    }
  },
};

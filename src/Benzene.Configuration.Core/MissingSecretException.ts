/**
 * Thrown when one or more required secrets are absent or blank. Carries the full list of missing names
 * so a misconfigured deployment fails fast at startup with everything that is wrong at once, not one
 * redeploy at a time.
 * Port of Benzene.Configuration.Core.MissingSecretException.
 */
export class MissingSecretException extends Error {
  /** The required names that were absent or blank. */
  readonly missingNames: readonly string[];

  constructor(missingNames: readonly string[]) {
    super(`Required secret(s) missing or empty: ${missingNames.join(', ')}`);
    this.name = 'MissingSecretException';
    this.missingNames = missingNames;
    Object.setPrototypeOf(this, MissingSecretException.prototype);
  }
}

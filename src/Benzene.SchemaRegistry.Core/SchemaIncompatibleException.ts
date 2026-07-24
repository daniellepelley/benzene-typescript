/** Port of Benzene.SchemaRegistry.Core.SchemaIncompatibleException. */

/**
 * Thrown when registering a schema that isn't compatible with the subject's existing versions under
 * the configured compatibility mode - the registry's way of stopping a breaking contract change at the
 * source. C# `Exception` subclass -> an `Error` subclass carrying the `subject`.
 */
export class SchemaIncompatibleException extends Error {
  constructor(readonly subject: string) {
    super(`Schema for subject '${subject}' is not compatible with the subject's latest version.`);
    this.name = 'SchemaIncompatibleException';
  }
}

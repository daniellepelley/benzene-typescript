/** Port of Benzene.Core.Versioning.Schemas.PayloadSchemaVersions. */

/**
 * Declares, per topic, which payload schema versions may be cast from and to - the set of pairs the
 * {@link SchemaCastDefinitionsExpander} must be able to satisfy (directly or by composing a chain).
 *
 * C#'s `required init` properties -> a plain object type (this is pure input data, never resolved from
 * the container).
 */
export interface PayloadSchemaVersions {
  readonly topic: string;
  readonly fromSchemas: readonly string[];
  readonly toSchemas: readonly string[];
}

/** Port of Benzene.SchemaRegistry.Core.ISchemaCompatibilityChecker (+ TextualSchemaCompatibilityChecker). */
import { RegisteredSchema } from './RegisteredSchema';
import { SchemaCompatibilityMode } from './SchemaCompatibilityMode';
import { SchemaDefinition } from './SchemaDefinition';

/**
 * Decides whether a candidate schema is compatible with the current latest for its subject. Pulled out
 * as a seam because a real structural check (does an Avro/JSON change preserve read/write compatibility)
 * is format-specific - a registry adapter usually delegates this to the server, and an in-process
 * registry can be given a smarter checker than the textual default.
 */
export interface ISchemaCompatibilityChecker {
  /**
   * Returns whether `candidate` may be registered given the subject's current `latest` version
   * (`undefined` when the subject has no versions yet).
   */
  isCompatible(
    latest: RegisteredSchema | undefined,
    candidate: SchemaDefinition,
    mode: SchemaCompatibilityMode,
  ): boolean;
}

/**
 * The default {@link ISchemaCompatibilityChecker}: a first schema for a subject is always compatible,
 * {@link SchemaCompatibilityMode.None} accepts anything, and otherwise the candidate must be textually
 * identical to the latest. Deliberately conservative - it never falsely approves a structural change;
 * supply a format-aware checker (or rely on the registry server's own check) for true evolution rules.
 */
export class TextualSchemaCompatibilityChecker implements ISchemaCompatibilityChecker {
  isCompatible(
    latest: RegisteredSchema | undefined,
    candidate: SchemaDefinition,
    mode: SchemaCompatibilityMode,
  ): boolean {
    if (latest === undefined || mode === SchemaCompatibilityMode.None) {
      return true;
    }

    return latest.schema === candidate.schema;
  }
}

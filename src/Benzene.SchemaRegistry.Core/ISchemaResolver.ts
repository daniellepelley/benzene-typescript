/** Port of Benzene.SchemaRegistry.Core.ISchemaResolver (+ DelegateSchemaResolver). */
import { Constructor } from '@benzene/abstractions';
import { SchemaDefinition } from './SchemaDefinition';

/**
 * Maps a message class to the {@link SchemaDefinition} (subject + schema text + format) to register for
 * it. Kept as a seam so the schema source stays pluggable and format-specific - e.g. an adapter over
 * `@benzene/avro`'s schema source supplies the Avro schema, without this package depending on Avro.
 *
 * C#'s runtime `Type` becomes a `Constructor` (the message class), per the port's type-erasure
 * convention (same as `@benzene/avro`).
 */
export interface ISchemaResolver {
  /** Returns the schema definition to register for `type`. */
  resolve(type: Constructor<unknown>): SchemaDefinition;
}

/** An {@link ISchemaResolver} backed by an inline function. */
export class DelegateSchemaResolver implements ISchemaResolver {
  constructor(private readonly resolveFn: (type: Constructor<unknown>) => SchemaDefinition) {}

  resolve(type: Constructor<unknown>): SchemaDefinition {
    return this.resolveFn(type);
  }
}

/** Port of Benzene.SchemaRegistry.Core.SchemaCompatibilityMode. */

/**
 * How a new schema version must relate to the existing ones for a subject - the standard
 * schema-registry compatibility levels. C# enum -> TypeScript `enum`.
 */
export enum SchemaCompatibilityMode {
  /** No compatibility is enforced; any new schema is accepted. */
  None,

  /** Consumers using the new schema can read data written with the previous schema. */
  Backward,

  /** Consumers using the previous schema can read data written with the new schema. */
  Forward,

  /** Both {@link Backward} and {@link Forward} hold. */
  Full,
}

/** Port of Benzene.Azure.CosmosDb.CosmosChangeType. */

/**
 * The kind of change a document underwent, as surfaced by the change feed's
 * *all-versions-and-deletes* mode. A Benzene-owned projection of the Cosmos change feed's operation
 * type, so change handlers don't take a direct dependency on the SDK's wire vocabulary.
 *
 * PORTING NOTE: the C# `enum` becomes a frozen object + union type (the port's convention for closed
 * enums), preserving the underlying numeric values (`Create = 0`, `Replace = 1`, `Delete = 2`).
 */
export const CosmosChangeType = {
  /** The document was created. */
  Create: 0,
  /** The document was replaced/updated. */
  Replace: 1,
  /** The document was deleted (only surfaced in all-versions-and-deletes mode). */
  Delete: 2,
} as const;

export type CosmosChangeType = (typeof CosmosChangeType)[keyof typeof CosmosChangeType];

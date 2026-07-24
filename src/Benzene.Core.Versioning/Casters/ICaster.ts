/** Port of Benzene.Core.Versioning.Casters.ICaster. */

/** Converts a payload from one schema version's shape (`TFrom`) into another's (`TTo`). */
export interface ICaster<TFrom, TTo> {
  cast(from: TFrom): TTo;
}

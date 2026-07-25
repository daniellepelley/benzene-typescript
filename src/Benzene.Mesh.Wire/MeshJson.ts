/** Port of Benzene.Mesh.Wire.MeshJson. */

/**
 * A JSON object as it appears on the wire. `System.Text.Json.Nodes.JsonObject` -> arbitrary
 * `Record<string, unknown>`, matching the rest of the mesh packages.
 */
export type JsonObject = Record<string, unknown>;

/**
 * The one place this package's wire serialization settings live: camelCase names (the wire
 * contract's casing, docs/specification/wire-contracts.md §6), nulls/undefined omitted.
 *
 * In the C# original this is a `JsonSerializerOptions` with `CamelCase` naming and
 * `WhenWritingNull`. The TypeScript port's descriptor field names are already camelCase and its
 * optional fields are `undefined` (not `null`); `JSON.stringify` omits `undefined`-valued
 * properties and preserves declaration/insertion order, so both settings come for free. Both the
 * descriptor hash canonicalization (see `MeshDescriptorHashing`) and any wire emission use this
 * helper so the two can't drift apart.
 */
export const MeshJson = {
  serialize<T>(value: T): string {
    return JSON.stringify(value);
  },
} as const;

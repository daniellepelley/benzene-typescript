/**
 * The subset of JSON Schema (2020-12) that a Benzene service's mesh ServiceDescriptor carries per
 * topic (docs/specification/mesh.md §2.1). This is the language-neutral contract the generator reads:
 * a C#, Go, or TypeScript service all emit the same shape, so the generated client is truly
 * cross-language - it never sees the producing runtime, only its schemas.
 *
 * Deliberately narrow: the §2.1 mapping produces exactly these constructs (self-contained, no `$ref`,
 * recursion cut with `{}`), so a bespoke reader/emitter for this subset is both complete for the
 * contract and free of the heavyweight general-purpose JSON-Schema tooling (`json-schema-to-typescript`
 * et al.) - the drop-in if arbitrary schemas ever need supporting.
 */
export interface JsonSchema {
  /** A single type (`"string"`) or a nullable union (`["string", "null"]`), per §2.1's nullable rule. */
  type?: string | string[];
  format?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  additionalProperties?: JsonSchema | boolean;
}

/** Reads the (possibly `undefined`) inline schema object off a descriptor topic as a `JsonSchema`. */
export function asJsonSchema(value: Record<string, unknown> | undefined): JsonSchema | undefined {
  return value as JsonSchema | undefined;
}

/** The single non-null type name of a schema, plus whether `"null"` was one of its declared types. */
export function readType(schema: JsonSchema): { baseType: string | undefined; nullable: boolean } {
  if (Array.isArray(schema.type)) {
    const nonNull = schema.type.filter((t) => t !== 'null');
    return { baseType: nonNull[0], nullable: schema.type.includes('null') };
  }
  return { baseType: schema.type, nullable: false };
}

/**
 * Port of Benzene.CodeGen.Client.OpenApiSchemaCSharpTypeBuilder, retargeted to TypeScript: turns a
 * named object schema into an exported `interface`. The mesh descriptor's schemas are self-contained
 * and inline (§2.1: no `$ref`, recursion cut with `{}`), so there is no component catalogue, `allOf`
 * base resolution, or discriminator handling to port - a named schema is simply its own properties,
 * with nested object properties rendered as inline object types by {@link typeExpression}.
 */
import { JsonSchema } from './JsonSchema';
import { objectProperties, typeExpression } from './TypeScriptTypeName';

/** True when a schema is worth a named `interface` (an object with at least one property). */
export function isNamedObjectSchema(schema: JsonSchema | undefined): boolean {
  return schema?.properties !== undefined && Object.keys(schema.properties).length > 0;
}

/** Emits `export interface <name> { … }` for an object schema's own properties. */
export function buildInterface(name: string, schema: JsonSchema): string {
  const lines = [`export interface ${name} {`];
  for (const property of objectProperties(schema)) {
    lines.push(`  ${property.member}${property.optional ? '?' : ''}: ${property.type};`);
  }
  lines.push('}');
  return lines.join('\n');
}

/**
 * The type to reference for a topic payload: a named interface when the schema warrants one (returned
 * in `declaration`), else the inline expression (`unknown`, `Record<string, unknown>`, a primitive, …).
 */
export function resolvePayloadType(
  name: string,
  schema: JsonSchema | undefined,
): { type: string; declaration?: string } {
  if (isNamedObjectSchema(schema)) {
    return { type: name, declaration: buildInterface(name, schema!) };
  }
  return { type: typeExpression(schema) };
}

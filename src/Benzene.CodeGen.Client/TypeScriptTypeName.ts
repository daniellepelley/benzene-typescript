/**
 * Port of Benzene.CodeGen.Client.CSharpTypeName (`ITypeName`), retargeted from `OpenApiSchema` to the
 * §2.1 `JsonSchema` subset and from C# type names to TypeScript. Maps a schema to the TypeScript type
 * expression that describes its marshaled JSON form:
 *
 * | schema | TypeScript |
 * |---|---|
 * | `{"type":"string"}` (incl. `format:"date-time"`, since the wire form is an RFC 3339 string) | `string` |
 * | `{"type":"boolean"}` | `boolean` |
 * | `{"type":"integer"}` / `{"type":"number"}` | `number` |
 * | `{"type":"array","items":T}` | `T[]` (`(T)[]` when `T` is a union) |
 * | `{"type":"object","properties":{…}}` | an inline object type `{ a: A; b?: B }` |
 * | `{"type":"object","additionalProperties":T}` | `Record<string, T>` |
 * | nullable `["X","null"]` | `X | null` |
 * | `{}` / absent / unknown construct | `unknown` |
 */
import { JsonSchema, readType } from './JsonSchema';
import { isSafeIdentifier } from './NameFormatter';

/** One property of an object schema, resolved to its emitted name, optionality and type expression. */
export interface PropertyEntry {
  /** The property name as it appears in a type body (quoted when it is not a bare identifier). */
  readonly member: string;
  readonly optional: boolean;
  readonly type: string;
}

/** The TypeScript type expression for a schema (an inline object literal for nested object schemas). */
export function typeExpression(schema: JsonSchema | undefined): string {
  if (schema === undefined) {
    return 'unknown';
  }

  const { baseType, nullable } = readType(schema);
  const expr = baseExpression(baseType, schema);
  return nullable ? `${expr} | null` : expr;
}

/** The properties of an object schema, in declaration order, resolved for emission. */
export function objectProperties(schema: JsonSchema): PropertyEntry[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, propertySchema]) => ({
    member: isSafeIdentifier(name) ? name : JSON.stringify(name),
    optional: !required.has(name),
    type: typeExpression(propertySchema),
  }));
}

function baseExpression(baseType: string | undefined, schema: JsonSchema): string {
  switch (baseType) {
    case 'string':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'integer':
    case 'number':
      return 'number';
    case 'array': {
      const item = typeExpression(schema.items);
      return item.includes(' | ') ? `(${item})[]` : `${item}[]`;
    }
    case 'object':
      return objectExpression(schema);
    case undefined:
      // No explicit type: an object shape may still be described by properties/additionalProperties;
      // otherwise it is the §2.1 unconstrained `{}` -> unknown.
      return schema.properties !== undefined || schema.additionalProperties !== undefined
        ? objectExpression(schema)
        : 'unknown';
    default:
      return 'unknown';
  }
}

function objectExpression(schema: JsonSchema): string {
  if (schema.properties !== undefined) {
    const members = objectProperties(schema).map(
      (p) => `${p.member}${p.optional ? '?' : ''}: ${p.type}`,
    );
    return members.length === 0 ? '{}' : `{ ${members.join('; ')} }`;
  }
  if (typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null) {
    return `Record<string, ${typeExpression(schema.additionalProperties)}>`;
  }
  return 'Record<string, unknown>';
}

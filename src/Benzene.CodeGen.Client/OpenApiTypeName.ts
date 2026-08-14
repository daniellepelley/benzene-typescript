/**
 * Maps a Contract Document OpenAPI 3.0 Schema Object to the TypeScript type expression that describes
 * its marshaled JSON form. Retargets `Benzene.CodeGen.Client.CSharpTypeName` (`ITypeName`) from
 * `OpenApiSchema`/C# to `OpenApiSchemaObject`/TypeScript, reusing the mesh-descriptor codegen path's
 * inline-object idiom (`TypeScriptTypeName.ts`) where the two schema shapes agree, and additionally
 * resolving `$ref` into a catalogue name (the mesh descriptor's schemas never carry one) and handling
 * `allOf`/`oneOf`/`anyOf` composition (which OpenAPI has and the mesh's §2.1 JSON-Schema subset does
 * not).
 *
 * | schema | TypeScript |
 * |---|---|
 * | `{"$ref": "#/components/schemas/Foo"}` | `Foo` (the catalogue name) |
 * | `{"type":"string"}` (incl. `format:"date-time"`/`"uuid"`) | `string` - TS has no marshaled-JSON
 *   `Date`/`Guid` type, so both stay `string`; the same bend `TypeScriptTypeName.ts` already documents |
 * | `{"type":"boolean"}` | `boolean` |
 * | `{"type":"integer"}` / `{"type":"number"}` | `number` |
 * | `{"type":"array","items":T}` | `T[]` (`(T)[]` when `T` is a union) |
 * | `{"type":"object","properties":{…}}` | an inline object type `{ a: A; b?: B }` |
 * | `{"type":"object","additionalProperties":T}` | `Record<string, T>` |
 * | `oneOf`/`anyOf` | a union of the members' own type expressions (a discriminated union when every
 *   member is a `$ref` to an object type - see `OpenApiPayloadBuilder.ts` for the divergence rationale) |
 * | `allOf` (inline use) | an intersection of the `$ref` bases and the merged inline members' own
 *   properties - a *named* catalogue entry with `allOf` instead becomes `interface … extends …`,
 *   built by `OpenApiPayloadBuilder.ts` using `mergeAllOf` below |
 * | `nullable: true` | `X \| null` |
 * | `{}` / absent / unrecognized construct | `unknown` |
 */
import { OpenApiSchemaObject, refName } from './ContractDocument';
import { isSafeIdentifier } from './NameFormatter';

export interface OpenApiPropertyEntry {
  readonly member: string;
  readonly optional: boolean;
  readonly type: string;
}

/** The TypeScript type expression for `schema`, resolving any `$ref` to its catalogue name. */
export function typeExpression(schema: OpenApiSchemaObject | undefined): string {
  if (schema === undefined) {
    return 'unknown';
  }

  const expr = baseExpression(schema);
  return schema.nullable === true ? `${expr} | null` : expr;
}

/** The properties of an object schema, in declaration order, resolved for emission. */
export function objectProperties(schema: OpenApiSchemaObject): OpenApiPropertyEntry[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, propertySchema]) => ({
    member: isSafeIdentifier(name) ? name : JSON.stringify(name),
    optional: !required.has(name),
    type: typeExpression(propertySchema),
  }));
}

/**
 * Splits an `allOf` array into its `$ref` bases and the merged own properties of its inline members -
 * shared by this file's inline `allOfExpression` and `OpenApiPayloadBuilder.ts`'s named
 * `interface … extends …` emission. A name declared by more than one inline member keeps its
 * first declaration (matching the C# `OpenApiSchemaCSharpTypeBuilder.GetOwnProperties`'s
 * `GroupBy(...).First()` rule).
 */
export function mergeAllOf(members: OpenApiSchemaObject[]): { refs: string[]; own: OpenApiSchemaObject } {
  const refs = members.filter((member) => member.$ref !== undefined).map((member) => refName(member.$ref!));
  const inlineMembers = members.filter((member) => member.$ref === undefined);

  const own: OpenApiSchemaObject = { type: 'object', properties: {}, required: [] };
  for (const member of inlineMembers) {
    for (const [name, propertySchema] of Object.entries(member.properties ?? {})) {
      if (!(name in own.properties!)) {
        own.properties![name] = propertySchema;
      }
    }
    own.required = [...(own.required ?? []), ...(member.required ?? [])];
  }

  return { refs, own };
}

function baseExpression(schema: OpenApiSchemaObject): string {
  if (schema.$ref !== undefined) {
    return refName(schema.$ref);
  }
  if (schema.oneOf !== undefined && schema.oneOf.length > 0) {
    return unionExpression(schema.oneOf);
  }
  if (schema.anyOf !== undefined && schema.anyOf.length > 0) {
    return unionExpression(schema.anyOf);
  }
  if (schema.allOf !== undefined && schema.allOf.length > 0) {
    return allOfExpression(schema.allOf);
  }

  switch (schema.type) {
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
      // otherwise it is an unconstrained `{}` -> unknown.
      return schema.properties !== undefined || schema.additionalProperties !== undefined
        ? objectExpression(schema)
        : 'unknown';
    default:
      return 'unknown';
  }
}

function unionExpression(members: OpenApiSchemaObject[]): string {
  const types = [...new Set(members.map((member) => typeExpression(member)))];
  return types.join(' | ');
}

function allOfExpression(members: OpenApiSchemaObject[]): string {
  const { refs, own } = mergeAllOf(members);
  const parts = [...refs];
  if (refs.length === 0 || Object.keys(own.properties ?? {}).length > 0) {
    parts.push(objectExpression(own));
  }
  return parts.length > 0 ? parts.join(' & ') : '{}';
}

function objectExpression(schema: OpenApiSchemaObject): string {
  if (schema.properties !== undefined) {
    const members = objectProperties(schema).map((p) => `${p.member}${p.optional ? '?' : ''}: ${p.type}`);
    return members.length === 0 ? '{}' : `{ ${members.join('; ')} }`;
  }
  if (typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null) {
    return `Record<string, ${typeExpression(schema.additionalProperties)}>`;
  }
  return 'Record<string, unknown>';
}

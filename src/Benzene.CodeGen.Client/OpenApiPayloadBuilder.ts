/**
 * Emits one named TypeScript declaration per `components.schemas` catalogue entry. Retargets
 * `Benzene.CodeGen.Client.OpenApiSchemaCSharpTypeBuilder` from C# classes to TypeScript
 * interfaces/type aliases.
 *
 * **Deliberate TS-idiom divergence (documented per the porting-conventions rule, README):** the C#
 * builder types a `oneOf` **use site** as the branches' shared `allOf` base class (reading the
 * discriminator only as `[JsonPolymorphic]`/`[JsonDerivedType]` attributes on that base, so the
 * compile-time type at any reference is just the base, e.g. `PaymentEvent`, not the specific variant).
 * A TypeScript developer would never write that when a real discriminated union is available and
 * checkable at compile time - `buildTypeDeclaration` instead emits a `oneOf`/`anyOf` catalogue entry as
 * a **union type alias** of its members' own types (`export type D = E | F;`), so every reference to
 * `D` is the actual, narrowable union - a strict improvement over the base-class typing, not merely a
 * different-but-equal choice. The `discriminator.mapping` metadata (which C# reads to drive the
 * attribute pair) is not otherwise consulted: TypeScript's own structural typing already discriminates
 * a union of distinct object shapes without a literal tag property being synthesized.
 */
import { OpenApiSchemaObject } from './ContractDocument';
import { mergeAllOf, objectProperties, typeExpression } from './OpenApiTypeName';
import { toIdentifierSegment } from './NameFormatter';

/** `export interface <Name> { … }` / `export type <Name> = …;` for one catalogue entry. */
export function buildTypeDeclaration(rawName: string, schema: OpenApiSchemaObject): string {
  const name = toIdentifierSegment(rawName);

  if (schema.oneOf !== undefined && schema.oneOf.length > 0) {
    return `export type ${name} = ${unionOf(schema.oneOf)};`;
  }
  if (schema.anyOf !== undefined && schema.anyOf.length > 0) {
    return `export type ${name} = ${unionOf(schema.anyOf)};`;
  }
  if (schema.allOf !== undefined && schema.allOf.length > 0) {
    return buildAllOfInterface(name, schema.allOf);
  }
  if (schema.$ref !== undefined) {
    return `export type ${name} = ${typeExpression(schema)};`;
  }
  if (schema.properties !== undefined) {
    return buildPropertiesInterface(name, schema);
  }
  if (typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null) {
    return `export type ${name} = Record<string, ${typeExpression(schema.additionalProperties)}>;`;
  }
  if (schema.type === 'array') {
    return `export type ${name} = ${typeExpression(schema)};`;
  }
  if (schema.type === 'string' || schema.type === 'boolean' || schema.type === 'integer' || schema.type === 'number') {
    return `export type ${name} = ${typeExpression(schema)};`;
  }

  // An object with no declared properties and no additionalProperties schema (e.g. the Contract
  // Document's conventional `Void` request/response) - a legitimately empty payload.
  return `export interface ${name} {}`;
}

/** Every catalogue entry's declaration, in the catalogue's own key order. */
export function buildTypeDeclarations(catalogue: Record<string, OpenApiSchemaObject>): string[] {
  return Object.entries(catalogue).map(([name, schema]) => buildTypeDeclaration(name, schema));
}

function unionOf(members: OpenApiSchemaObject[]): string {
  const types = [...new Set(members.map((member) => typeExpression(member)))];
  return types.join(' | ');
}

function buildAllOfInterface(name: string, allOf: OpenApiSchemaObject[]): string {
  const { refs, own } = mergeAllOf(allOf);
  const extendsClause = refs.length > 0 ? ` extends ${refs.map(toIdentifierSegment).join(', ')}` : '';
  return renderInterface(name, extendsClause, objectProperties(own));
}

function buildPropertiesInterface(name: string, schema: OpenApiSchemaObject): string {
  return renderInterface(name, '', objectProperties(schema));
}

function renderInterface(
  name: string,
  extendsClause: string,
  properties: ReturnType<typeof objectProperties>,
): string {
  const lines = [`export interface ${name}${extendsClause} {`];
  for (const property of properties) {
    lines.push(`  ${property.member}${property.optional ? '?' : ''}: ${property.type};`);
  }
  lines.push('}');
  return lines.join('\n');
}

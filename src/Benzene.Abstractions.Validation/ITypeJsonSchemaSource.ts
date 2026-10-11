import { Constructor, ServiceToken, serviceToken } from '@benzenejs/abstractions';

/**
 * Supplies a JSON Schema for a request/response type — the runtime source of a topic's payload schema in the
 * benzene Contract Document.
 *
 * TypeScript-only abstraction with no direct C# counterpart. `Benzene.Schema.OpenApi` derives a topic's
 * schema by *reflecting* over the CLR request/response type; TypeScript erases types, so there is nothing to
 * reflect over and the schema must instead be *provided* by whatever knows the shape at runtime — a
 * validation schema (`@benzenejs/zod`/`joi`/`yup`), a hand-authored map, or a wire schema registry. Each such
 * source registers an implementation; a composer tries every registered source until one answers (the same
 * multi-registration + `getServices` pattern the mesh uses for `IMeshServiceSource`). A source returns
 * `undefined` for a type it doesn't know, leaving the topic's payload unconstrained — the spec's `{}` case.
 *
 * `type` is a class constructor (the runtime stand-in for C#'s `Type`, per the port's type-erasure
 * convention); the returned value is a JSON Schema object, or `undefined` when this source has none.
 * The schema is a Schema Object in the Contract Document's OpenAPI 3.0 dialect (contract-document.md §4.2).
 * It MAY carry named sub-schemas under `$defs`, referenced as `#/$defs/<name>`, and MAY refer to itself as
 * `#` (a recursive type): the spec builder hoists every one of them into `components.schemas`.
 *
 * Resolved from the container, so a merged `ServiceToken` of the same name is declared.
 */
export interface ITypeJsonSchemaSource {
  getJsonSchema(type: Constructor<unknown>): Record<string, unknown> | undefined;

  /**
   * The type's declared schema name (contract-document.md §4.1 rule 5) — the component name the spec uses
   * instead of the class name, and the remedy for a name collision. `undefined` when this source declares
   * none (the class name is then used). Each schema library's idiom: Zod `.meta({ id })`, Joi `.id()`, Yup
   * `.meta({ id })`, `MapTypeJsonSchemaSource.register(type, schema, { name })`.
   */
  getSchemaName?(type: Constructor<unknown>): string | undefined;
}

export const ITypeJsonSchemaSource: ServiceToken<ITypeJsonSchemaSource> =
  serviceToken<ITypeJsonSchemaSource>('ITypeJsonSchemaSource');

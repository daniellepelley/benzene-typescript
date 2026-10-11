import { ServiceIdentifier, ServiceToken, serviceToken } from '@benzenejs/abstractions';

/**
 * Accumulates a spec document's shared schema catalogue (`components.schemas`) and hands back a `$ref` for
 * each schema it stores, so a request/response/message carries only a reference and the schema body lives
 * once at the document root. Port of Benzene.Schema.OpenApi.ISchemaBuilder.
 *
 * Divergence: C#'s `AddSchema(Type)` generates the schema by reflecting over the CLR type (Swashbuckle);
 * TypeScript erases types, so the schema is *sourced* from the registered `ITypeJsonSchemaSource`s (the
 * validation-derived / bring-your-own schemas) — the same seam the mesh descriptor uses. `Type` → a runtime
 * `ServiceIdentifier` (class constructor / `VoidResult` sentinel).
 *
 * A builder accumulates ONE document's catalogue and is stateful — construct a fresh one per spec build.
 */
export interface ISchemaBuilder {
  /** The accumulated `schemaId → schema` catalogue (the document's `components.schemas`), sorted by id. */
  build(): Record<string, Record<string, unknown>>;

  /**
   * Records the schema for `type` (from the registered sources) under its component name — the declared
   * schema name, else the class name — and returns a `$ref` to it. A `VoidResult`/unknown type — or a type
   * with no source schema — yields an empty inline schema `{}` (unconstrained), never a dangling `$ref`.
   * `usage` (e.g. `"orders:create (request)"`) names the use for a collision error. Throws
   * `ComponentNameCollisionError` when a different schema already holds the name (contract-document.md §4.1).
   */
  addSchema(type: ServiceIdentifier<unknown>, usage?: string): Record<string, unknown>;

  /** Records a hand-supplied `schema` under `schemaId` and returns a `$ref` to it (same collision rule). */
  addNamedSchema(schemaId: string, schema: Record<string, unknown>, usage?: string): Record<string, unknown>;
}

export const ISchemaBuilder: ServiceToken<ISchemaBuilder> = serviceToken<ISchemaBuilder>('ISchemaBuilder');

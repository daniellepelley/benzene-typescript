import { Constructor } from '@benzenejs/abstractions';
import { ITypeJsonSchemaSource } from './ITypeJsonSchemaSource';

/**
 * A "bring your own schema" `ITypeJsonSchemaSource`: hand-authored JSON Schemas keyed by request/response
 * type. Register the schema a type should publish and it surfaces in the spec / mesh descriptor exactly like
 * a validator-derived one — the runtime equivalent of .NET's `SuppliedSchemaCatalog` (`AddSuppliedSchemas`),
 * for services that don't validate with Zod/Joi/Yup or that want to override the derived schema (e.g. to
 * publish a curated contract, or a schema pulled from a wire schema registry's JSON entries).
 *
 * Compose it alongside the validator sources: a `ValidationMeshSchemaProvider` tries every registered source
 * in turn, so a hand-authored schema and a validator-derived one coexist (registration order decides which
 * wins for a type both cover).
 */
export class MapTypeJsonSchemaSource implements ITypeJsonSchemaSource {
  private readonly schemas = new Map<Constructor<unknown>, Record<string, unknown>>();
  private readonly names = new Map<Constructor<unknown>, string>();

  constructor(entries?: Iterable<readonly [Constructor<unknown>, Record<string, unknown>]>) {
    if (entries !== undefined) {
      for (const [type, schema] of entries) {
        this.schemas.set(type, schema);
      }
    }
  }

  /**
   * Registers (or replaces) the schema published for a type. Returns `this` for chaining. `options.name`
   * declares the type's schema name (contract-document.md §4.1 rule 5): the component key the spec uses
   * in place of the class name — the remedy when two different types share a class name.
   */
  register(type: Constructor<unknown>, schema: Record<string, unknown>, options?: { name?: string }): this {
    this.schemas.set(type, schema);
    if (options?.name !== undefined) {
      this.names.set(type, options.name);
    } else {
      this.names.delete(type);
    }
    return this;
  }

  getJsonSchema(type: Constructor<unknown>): Record<string, unknown> | undefined {
    return this.schemas.get(type);
  }

  getSchemaName(type: Constructor<unknown>): string | undefined {
    return this.names.get(type);
  }
}

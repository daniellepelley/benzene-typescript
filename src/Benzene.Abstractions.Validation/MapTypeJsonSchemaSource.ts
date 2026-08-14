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

  constructor(entries?: Iterable<readonly [Constructor<unknown>, Record<string, unknown>]>) {
    if (entries !== undefined) {
      for (const [type, schema] of entries) {
        this.schemas.set(type, schema);
      }
    }
  }

  /** Registers (or replaces) the JSON Schema published for a type. Returns `this` for chaining. */
  register(type: Constructor<unknown>, schema: Record<string, unknown>): this {
    this.schemas.set(type, schema);
    return this;
  }

  getJsonSchema(type: Constructor<unknown>): Record<string, unknown> | undefined {
    return this.schemas.get(type);
  }
}

import { Constructor, ServiceIdentifier, VoidResult } from '@benzenejs/abstractions';
import { ITypeJsonSchemaSource } from '@benzenejs/abstractions-validation';
import { ISchemaBuilder } from './ISchemaBuilder';

/**
 * The default `ISchemaBuilder`. Where C#'s `SchemaBuilder` generates schemas with Swashbuckle by reflecting
 * over the CLR type, this sources them from the registered `ITypeJsonSchemaSource`s (validation-derived or
 * bring-your-own) — the runtime replacement for reflection. Each stored schema is keyed by the type's class
 * name and referenced by `$ref`; the body lives once in `build()`'s catalogue.
 */
export class SchemaBuilder implements ISchemaBuilder {
  private readonly components: Record<string, Record<string, unknown>> = {};

  constructor(private readonly sources: readonly ITypeJsonSchemaSource[] = []) {}

  build(): Record<string, Record<string, unknown>> {
    const sorted: Record<string, Record<string, unknown>> = {};
    for (const key of Object.keys(this.components).sort()) {
      sorted[key] = this.components[key];
    }
    return sorted;
  }

  addSchema(type: ServiceIdentifier<unknown>): Record<string, unknown> {
    if (typeof type !== 'function' || type === VoidResult) {
      return {};
    }
    const ctor = type as Constructor<unknown>;
    const schema = this.resolve(ctor);
    if (schema === undefined) {
      return {};
    }
    // A nameless (anonymous) class can't key a stable component, so inline it rather than mint a bad $ref.
    return ctor.name === '' ? schema : this.addNamedSchema(ctor.name, schema);
  }

  addNamedSchema(schemaId: string, schema: Record<string, unknown>): Record<string, unknown> {
    if (!(schemaId in this.components)) {
      this.components[schemaId] = schema;
    }
    return { $ref: `#/components/schemas/${schemaId}` };
  }

  private resolve(ctor: Constructor<unknown>): Record<string, unknown> | undefined {
    for (const source of this.sources) {
      const schema = source.getJsonSchema(ctor);
      if (schema !== undefined) {
        return schema;
      }
    }
    return undefined;
  }
}

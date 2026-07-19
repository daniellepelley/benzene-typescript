/** Port of Benzene.Avro.AvroSchemaResolver. */
import { Constructor } from '@benzene/abstractions';
import * as avro from 'avsc';
import { AvroOptions } from './AvroOptions';
import { AvroSchemaRegistry } from './AvroSchemaRegistry';
import { IAvroSchemaResolver } from './IAvroSchemaResolver';

/**
 * Default {@link IAvroSchemaResolver}: returns the `avro.Type` registered for a message class, from the
 * options-scoped registry first and then the process-wide {@link AvroSchemaRegistry.global}; if neither
 * has one, it throws.
 * Port of Benzene.Avro.AvroSchemaResolver.
 *
 * **Reflection → registry adaptation.** The C# resolver falls back to reflection-generated schemas
 * (`AvroSchemaGenerator`) for unregistered types, only throwing when `UseReflectionSchemas` is off.
 * TypeScript type erasure removes the reflection path entirely (see {@link AvroSchemaRegistry}), so an
 * unregistered type always throws here — the schema must be registered via `registerAvroSchema(...)` or
 * `AvroOptions.registerSchema(...)`. Schema compilation/caching lives in the registries (the counterpart
 * of the C# resolver's per-type `Schema` cache).
 */
export class AvroSchemaResolver implements IAvroSchemaResolver {
  constructor(private readonly options: AvroOptions = new AvroOptions()) {}

  getSchema(messageType: Constructor<unknown>): avro.Type {
    const explicit = this.options.explicitSchemas.get(messageType);
    if (explicit !== undefined) {
      return explicit;
    }

    const global = AvroSchemaRegistry.global.get(messageType);
    if (global !== undefined) {
      return global;
    }

    const name = messageType.name || String(messageType);
    throw new Error(
      `No Avro schema is registered for '${name}'. Reflection-based schema generation has no ` +
        `TypeScript equivalent (types are erased at runtime), so an explicit schema is required: ` +
        `register one via registerAvroSchema(${name}, schema) or AddAvro(o => o.registerSchema(${name}, schema)).`,
    );
  }
}

/** Port of Benzene.Avro.AvroOptions. */
import { Constructor } from '@benzene/abstractions';
import { AvroSchemaInput, AvroSchemaRegistry } from './AvroSchemaRegistry';

/**
 * Configures how {@link AvroSerializer} obtains an Avro schema for a message class. Avro is
 * schema-based (unlike JSON), so every serialized type needs a schema.
 *
 * **Reflection → registry adaptation.** The .NET `AvroOptions` supports two modes: an explicit
 * per-type `.avsc` registration, and (default) reflection-inferred schemas via `AvroSchemaGenerator`.
 * TypeScript has no runtime type information, so reflection inference cannot be ported — see
 * {@link AvroSchemaRegistry}. Only the explicit-registration mode survives: `registerSchema` records a
 * schema against a message class (into an options-scoped {@link AvroSchemaRegistry}), matching the
 * schema-registry model common in finance/Kafka deployments.
 *
 * {@link useReflectionSchemas} is kept for signature/config parity with the .NET options, but is inert:
 * with no reflection available, a message class that has no registered schema always throws at resolve
 * time regardless of this flag's value.
 */
export class AvroOptions {
  /** The explicit registrations made through these options, scoped to the serializer they configure. */
  readonly explicitSchemas: AvroSchemaRegistry = new AvroSchemaRegistry();

  /**
   * Retained for parity with .NET's `AvroOptions.UseReflectionSchemas` (default `true`). Inert in the
   * port: TypeScript type erasure means there is no reflection fallback, so an unregistered type always
   * throws whatever this is set to. Documented here rather than removed to keep the config shape aligned.
   */
  useReflectionSchemas = true;

  /**
   * Registers an explicit Avro schema for a message class. Accepts an `avro.Type` or a plain Avro
   * schema object. Returns these options, for chaining. Port of C# `RegisterSchema<T>(string)` /
   * `RegisterSchema(Type, string)` (the `.avsc` JSON string becomes an avsc schema object/`Type`).
   */
  registerSchema(messageType: Constructor<unknown>, schema: AvroSchemaInput): AvroOptions {
    this.explicitSchemas.register(messageType, schema);
    return this;
  }
}

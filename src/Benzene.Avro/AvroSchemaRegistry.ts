/** Port of Benzene.Avro (the reflection→registry adaptation of AvroSchemaResolver's schema source). */
import { Constructor } from '@benzene/abstractions';
import * as avro from 'avsc';

/**
 * The value accepted when registering a schema for a message class: either an already-compiled
 * avsc {@link avro.Type} or a plain Avro schema object (`{ type: 'record', ... }`) that
 * `avro.Type.forSchema(...)` compiles.
 */
export type AvroSchemaInput = avro.Type | object;

/** `avro.Type.forSchema`'s parameter type, referenced structurally because avsc does not export it. */
type ForSchemaArg = Parameters<typeof avro.Type.forSchema>[0];

/**
 * TypeScript-only file with no direct C# counterpart, filling the role that reflection-based schema
 * generation (`AvroSchemaGenerator` + `AvroOptions.ExplicitSchemas`) plays in `Benzene.Avro`.
 *
 * **Reflection → registry adaptation.** Avro is schema-based: every serialized type needs an Avro
 * schema. In .NET `AvroSchemaResolver` obtains one either from an explicitly-registered `.avsc` string
 * or, by default, by *reflecting* over the CLR type's public properties (`AvroSchemaGenerator`).
 * TypeScript erases types at runtime — there is no way to enumerate a type's members to infer an
 * Avro-correct schema (with nullability, precision, records) from a `T`. So, exactly like the
 * validation adapters recover "which validator for TRequest" (see `ZodSchemaRegistry`), the schema is
 * associated with a message *class* (constructor) here and looked up by that constructor at
 * (de)serialize time. This registry is therefore the sole schema source; reflection generation is not
 * ported (documented on `AvroSchemaGenerator`'s absence and in `AvroOptions`).
 *
 * Mirrors the metadata-store pattern of `ZodSchemaRegistry` / `MessageHandlersRegistry`: a
 * process-wide `global` registry plus optional isolated instances for tests. Registered schemas are
 * compiled to an `avro.Type` lazily and cached, matching the C# resolver's per-type schema cache.
 */
export class AvroSchemaRegistry {
  static readonly global: AvroSchemaRegistry = new AvroSchemaRegistry();

  private readonly schemas = new Map<Constructor<unknown>, AvroSchemaInput>();
  private readonly compiled = new WeakMap<Constructor<unknown>, avro.Type>();

  /** Associates a message class with the avsc schema (a `Type` or plain schema object) used for it. */
  register(messageType: Constructor<unknown>, schema: AvroSchemaInput): void {
    this.schemas.set(messageType, schema);
    this.compiled.delete(messageType);
  }

  /** Whether a schema is registered for the given message class. */
  has(messageType: Constructor<unknown>): boolean {
    return this.schemas.has(messageType);
  }

  /**
   * Returns the compiled `avro.Type` for a message class, or `undefined` when none is registered.
   * A plain schema object is compiled via `avro.Type.forSchema(...)` on first use and cached; an
   * `avro.Type` is returned as-is.
   */
  get(messageType: Constructor<unknown>): avro.Type | undefined {
    const cached = this.compiled.get(messageType);
    if (cached !== undefined) {
      return cached;
    }

    const schema = this.schemas.get(messageType);
    if (schema === undefined) {
      return undefined;
    }

    const type = schema instanceof avro.Type ? schema : avro.Type.forSchema(schema as ForSchemaArg);
    this.compiled.set(messageType, type);
    return type;
  }
}

/**
 * Registers an Avro schema for a message class on the global registry — the adapter counterpart of
 * .NET's `AddAvro(o => o.RegisterSchema<T>("..."))` / reflection inference. Accepts an `avro.Type` or a
 * plain Avro schema object.
 */
export function registerAvroSchema(messageType: Constructor<unknown>, schema: AvroSchemaInput): void {
  AvroSchemaRegistry.global.register(messageType, schema);
}

/** Looks up (and lazily compiles) the `avro.Type` registered for a message class on the global registry. */
export function getAvroSchema(messageType: Constructor<unknown>): avro.Type | undefined {
  return AvroSchemaRegistry.global.get(messageType);
}

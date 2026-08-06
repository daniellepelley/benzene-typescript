import Ajv, { type AnySchema, type ValidateFunction } from 'ajv';
import { Constructor } from '@benzene/abstractions';

/**
 * TypeScript-only file with no direct C# counterpart, filling the role `Benzene.JsonSchema`'s
 * `IJsonSchemaProvider<TContext>` (backed by a `SuppliedJsonSchemaCatalog` keyed by request `Type`)
 * plays in .NET.
 *
 * This package ADAPTS ajv: a hand-authored JSON Schema plays the part of `Benzene.JsonSchema`'s supplied
 * schema. In .NET the middleware resolves the schema for the current topic's request `Type`; TypeScript
 * erases generic type arguments, so instead a request *class* (constructor) is associated with a JSON
 * Schema here, and the middleware finds "the schema for TRequest" by that constructor — the same
 * constructor-keyed pattern the Zod/Joi/Yup adapters use. A single process-wide `global` registry plus
 * isolated instances for tests mirrors `MessageHandlersRegistry` / `@message`.
 *
 * Each schema is compiled once (at registration) by a shared ajv instance into a reusable
 * {@link ValidateFunction}, the ajv analog of .NET's cached `Json.Schema.JsonSchema`. The raw schema is
 * kept alongside so {@link AjvJsonSchemaSource} can publish it to the spec/mesh descriptor unchanged.
 */

// Shared ajv instance. `allErrors` reports every failing keyword (like the C# `OutputFormat.List`
// evaluation and Zod's issues array) rather than stopping at the first.
const ajv = new Ajv({ allErrors: true });

interface RegisteredSchema {
  readonly schema: AnySchema;
  readonly validate: ValidateFunction;
}

export class AjvSchemaRegistry {
  static readonly global: AjvSchemaRegistry = new AjvSchemaRegistry();

  private readonly entries = new WeakMap<Constructor<unknown>, RegisteredSchema>();

  /**
   * Associates a request class with the JSON Schema that validates its instances, compiling the schema
   * eagerly so an invalid schema surfaces at registration rather than on the first request. A schema
   * carrying a `$id` already compiled under that `$id` makes ajv throw (its normal duplicate-id rule).
   */
  register<T>(requestType: Constructor<T>, schema: AnySchema): void {
    this.entries.set(requestType, { schema, validate: ajv.compile(schema) });
  }

  /** Returns the compiled validator for a request class, or `undefined` when none is registered. */
  getValidator(requestType: Constructor<unknown>): ValidateFunction | undefined {
    return this.entries.get(requestType)?.validate;
  }

  /** Returns the raw JSON Schema registered for a request class, or `undefined` when none is registered. */
  getSchema(requestType: Constructor<unknown>): AnySchema | undefined {
    return this.entries.get(requestType)?.schema;
  }
}

/**
 * Registers a JSON Schema for a request class on the global registry — the adapter counterpart of
 * `Benzene.JsonSchema`'s `SuppliedJsonSchemaCatalog.Add(type, schema)`.
 */
export function registerJsonSchema<T>(requestType: Constructor<T>, schema: AnySchema): void {
  AjvSchemaRegistry.global.register(requestType, schema);
}

/** Looks up the compiled validator registered for a request class on the global registry. */
export function getJsonSchemaValidator(requestType: Constructor<unknown>): ValidateFunction | undefined {
  return AjvSchemaRegistry.global.getValidator(requestType);
}

/** Looks up the raw JSON Schema registered for a request class on the global registry. */
export function getRegisteredJsonSchema(requestType: Constructor<unknown>): AnySchema | undefined {
  return AjvSchemaRegistry.global.getSchema(requestType);
}

import { Constructor } from '@benzene/abstractions';
import type { Schema } from 'joi';

/**
 * TypeScript-only file with no direct C# counterpart, filling the role FluentValidation's
 * `IValidator<TRequest>` DI resolution plays in `Benzene.FluentValidation`.
 *
 * This package ADAPTS Joi: a Joi schema plays the part of FluentValidation's `IValidator<TRequest>`.
 * In .NET the middleware resolves the validator for `TRequest` from the container by its runtime
 * `Type`. TypeScript erases generic type arguments, so instead a request *class* (constructor) is
 * associated with a Joi schema here, and the middleware finds "the schema for TRequest" by that
 * constructor. Mirrors the metadata-store pattern of `MessageHandlersRegistry` /
 * `@message` (`MessageAttribute`): a process-wide `global` registry plus optional isolated instances
 * for tests.
 */
export class JoiSchemaRegistry {
  static readonly global: JoiSchemaRegistry = new JoiSchemaRegistry();

  private readonly schemas = new WeakMap<Constructor<unknown>, Schema>();

  /** Associates a request class with the Joi schema that validates its instances. */
  register(requestType: Constructor<unknown>, schema: Schema): void {
    this.schemas.set(requestType, schema);
  }

  /** Returns the schema registered for a request class, or `undefined` when none is registered. */
  get(requestType: Constructor<unknown>): Schema | undefined {
    return this.schemas.get(requestType);
  }
}

/**
 * Registers a Joi schema for a request class on the global registry — the adapter counterpart of
 * FluentValidation's `services.AddSingleton<IValidator<TRequest>, ...>()`. Any Joi schema is accepted.
 */
export function registerJoiSchema(requestType: Constructor<unknown>, schema: Schema): void {
  JoiSchemaRegistry.global.register(requestType, schema);
}

/** Looks up the schema registered for a request class on the global registry. */
export function getJoiSchema(requestType: Constructor<unknown>): Schema | undefined {
  return JoiSchemaRegistry.global.get(requestType);
}

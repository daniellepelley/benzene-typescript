import { Constructor } from '@benzene/abstractions';
import type { ZodType } from 'zod';

/**
 * TypeScript-only file with no direct C# counterpart, filling the role FluentValidation's
 * `IValidator<TRequest>` DI resolution plays in `Benzene.FluentValidation`.
 *
 * This package ADAPTS Zod: a Zod schema plays the part of FluentValidation's `IValidator<TRequest>`.
 * In .NET the middleware resolves the validator for `TRequest` from the container by its runtime
 * `Type`. TypeScript erases generic type arguments, so instead a request *class* (constructor) is
 * associated with a Zod schema here, and the middleware finds "the schema for TRequest" by that
 * constructor. Mirrors the metadata-store pattern of `MessageHandlersRegistry` /
 * `@message` (`MessageAttribute`): a process-wide `global` registry plus optional isolated instances
 * for tests.
 */
export class ZodSchemaRegistry {
  static readonly global: ZodSchemaRegistry = new ZodSchemaRegistry();

  private readonly schemas = new WeakMap<Constructor<unknown>, ZodType>();

  /** Associates a request class with the Zod schema that validates its instances. */
  register(requestType: Constructor<unknown>, schema: ZodType): void {
    this.schemas.set(requestType, schema);
  }

  /** Returns the schema registered for a request class, or `undefined` when none is registered. */
  get(requestType: Constructor<unknown>): ZodType | undefined {
    return this.schemas.get(requestType);
  }
}

/**
 * Registers a Zod schema for a request class on the global registry — the adapter counterpart of
 * FluentValidation's `services.AddSingleton<IValidator<TRequest>, ...>()`. Any Zod schema is accepted.
 */
export function registerZodSchema(requestType: Constructor<unknown>, schema: ZodType): void {
  ZodSchemaRegistry.global.register(requestType, schema);
}

/** Looks up the schema registered for a request class on the global registry. */
export function getZodSchema(requestType: Constructor<unknown>): ZodType | undefined {
  return ZodSchemaRegistry.global.get(requestType);
}

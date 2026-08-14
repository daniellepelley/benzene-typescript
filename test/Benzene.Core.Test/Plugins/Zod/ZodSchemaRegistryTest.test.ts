import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { getZodSchema, registerZodSchema, ZodSchemaRegistry } from '@benzenejs/zod';

/**
 * Unit tests for `ZodSchemaRegistry` — the adapter's replacement for FluentValidation's
 * `IValidator<TRequest>` DI resolution (a request class → Zod schema association).
 */
describe('ZodSchemaRegistry', () => {
  it('registers and looks up a schema on the global registry', () => {
    class GlobalRequest {}
    const schema = z.object({ value: z.string() });

    registerZodSchema(GlobalRequest, schema);

    expect(getZodSchema(GlobalRequest)).toBe(schema);
  });

  it('returns undefined for a class with no registered schema', () => {
    class Unregistered {}

    expect(getZodSchema(Unregistered)).toBeUndefined();
  });

  it('binds the schema type to the request class (a mismatched schema is a compile error)', () => {
    class TypedRequest {
      name?: string;
    }

    // A matching schema is accepted...
    registerZodSchema(TypedRequest, z.object({ name: z.string() }));

    // ...and a schema for an unrelated shape is rejected at compile time (the `@ts-expect-error` fails
    // the build if this ever becomes assignable), which is the whole point of the typed binding.
    // @ts-expect-error - number is not assignable to the TypedRequest shape
    registerZodSchema(TypedRequest, z.object({ name: z.number() }));
  });

  it('supports isolated instances', () => {
    class InstanceRequest {}
    const schema = z.number();
    const registry = new ZodSchemaRegistry();

    registry.register(InstanceRequest, schema);

    expect(registry.get(InstanceRequest)).toBe(schema);
    // The instance registration does not leak into the global registry.
    expect(getZodSchema(InstanceRequest)).toBeUndefined();
  });
});

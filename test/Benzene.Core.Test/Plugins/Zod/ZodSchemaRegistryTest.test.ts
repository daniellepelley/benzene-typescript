import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { getZodSchema, registerZodSchema, ZodSchemaRegistry } from '@benzene/zod';

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

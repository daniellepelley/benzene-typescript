import { describe, expect, it } from 'vitest';
import Joi from 'joi';
import { getJoiSchema, registerJoiSchema, JoiSchemaRegistry } from '@benzene/joi';

/**
 * Unit tests for `JoiSchemaRegistry` — the adapter's replacement for FluentValidation's
 * `IValidator<TRequest>` DI resolution (a request class → Joi schema association).
 */
describe('JoiSchemaRegistry', () => {
  it('registers and looks up a schema on the global registry', () => {
    class GlobalRequest {}
    const schema = Joi.object({ value: Joi.string() });

    registerJoiSchema(GlobalRequest, schema);

    expect(getJoiSchema(GlobalRequest)).toBe(schema);
  });

  it('returns undefined for a class with no registered schema', () => {
    class Unregistered {}

    expect(getJoiSchema(Unregistered)).toBeUndefined();
  });

  it('supports isolated instances', () => {
    class InstanceRequest {}
    const schema = Joi.number();
    const registry = new JoiSchemaRegistry();

    registry.register(InstanceRequest, schema);

    expect(registry.get(InstanceRequest)).toBe(schema);
    // The instance registration does not leak into the global registry.
    expect(getJoiSchema(InstanceRequest)).toBeUndefined();
  });
});

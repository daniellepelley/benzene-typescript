import { describe, expect, it } from 'vitest';
import * as yup from 'yup';
import { getYupSchema, registerYupSchema, YupSchemaRegistry } from '@benzene/yup';

/**
 * Unit tests for `YupSchemaRegistry` — the adapter's replacement for FluentValidation's
 * `IValidator<TRequest>` DI resolution (a request class → Yup schema association).
 */
describe('YupSchemaRegistry', () => {
  it('registers and looks up a schema on the global registry', () => {
    class GlobalRequest {}
    const schema = yup.object({ value: yup.string() });

    registerYupSchema(GlobalRequest, schema);

    expect(getYupSchema(GlobalRequest)).toBe(schema);
  });

  it('returns undefined for a class with no registered schema', () => {
    class Unregistered {}

    expect(getYupSchema(Unregistered)).toBeUndefined();
  });

  it('supports isolated instances', () => {
    class InstanceRequest {}
    const schema = yup.number();
    const registry = new YupSchemaRegistry();

    registry.register(InstanceRequest, schema);

    expect(registry.get(InstanceRequest)).toBe(schema);
    // The instance registration does not leak into the global registry.
    expect(getYupSchema(InstanceRequest)).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import * as yup from 'yup';
import { yupToJsonSchema } from '@benzenejs/yup';

/**
 * Unit tests for `yupToJsonSchema` — the Yup → JSON Schema conversion (via `schema.describe()`) used to
 * publish a topic's payload schema in its spec/mesh descriptor. Verifies shape + rules land together,
 * including Yup's param-keyed inclusive/exclusive bound distinction.
 */
describe('yupToJsonSchema', () => {
  it('emits object shape with required, string min/max, and integer number rule', () => {
    const schema = yup.object({
      orderId: yup.string().min(3).max(10).required(),
      qty: yup.number().integer().min(1),
    });

    const json = yupToJsonSchema(schema);
    const props = json['properties'] as Record<string, Record<string, unknown>>;

    expect(json['type']).toBe('object');
    expect(props['orderId']).toMatchObject({ type: 'string', minLength: 3, maxLength: 10 });
    expect(props['qty']).toMatchObject({ type: 'integer', minimum: 1 });
    expect(json['required']).toEqual(['orderId']);
  });

  it('maps oneOf enums, formats (email), matches pattern, nested objects and arrays', () => {
    const schema = yup.object({
      email: yup.string().email(),
      code: yup.string().matches(/^[A-Z]{3}$/),
      status: yup.string().oneOf(['new', 'paid']),
      lines: yup.array().of(yup.object({ sku: yup.string() })).min(1),
    });

    const json = yupToJsonSchema(schema);
    const props = json['properties'] as Record<string, Record<string, unknown>>;

    expect(props['email']).toMatchObject({ type: 'string', format: 'email' });
    expect(props['code']).toMatchObject({ type: 'string', pattern: '^[A-Z]{3}$' });
    expect(props['status']).toMatchObject({ type: 'string', enum: ['new', 'paid'] });
    expect(props['lines']).toMatchObject({ type: 'array', minItems: 1 });
    const items = (props['lines'] as Record<string, unknown>)['items'] as Record<string, unknown>;
    expect(items['type']).toBe('object');
  });

  it('distinguishes exclusive bounds (moreThan/lessThan) from inclusive (min/max)', () => {
    const json = yupToJsonSchema(yup.object({ score: yup.number().moreThan(0).lessThan(100) }));
    const score = (json['properties'] as Record<string, Record<string, unknown>>)['score'];
    expect(score).toMatchObject({ type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 100 });
    expect(score['minimum']).toBeUndefined();
    expect(score['maximum']).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import Joi from 'joi';
import { joiSchemaName, joiToJsonSchema } from '@benzenejs/joi';

/**
 * Unit tests for `joiToJsonSchema` — the Joi → JSON Schema conversion (via `schema.describe()`) used to
 * publish a topic's payload schema in its spec/mesh descriptor. Verifies shape + rules land together across
 * strings, numbers, enums, formats, nested objects and arrays.
 */
describe('joiToJsonSchema', () => {
  it('emits object shape with required, string min/max, and integer number rule', () => {
    const schema = Joi.object({
      orderId: Joi.string().min(3).max(10).required(),
      qty: Joi.number().integer().min(1),
    });

    const json = joiToJsonSchema(schema);
    const props = json['properties'] as Record<string, Record<string, unknown>>;

    expect(json['type']).toBe('object');
    expect(props['orderId']).toMatchObject({ type: 'string', minLength: 3, maxLength: 10 });
    expect(props['qty']).toMatchObject({ type: 'integer', minimum: 1 });
    expect(json['required']).toEqual(['orderId']);
  });

  it('maps enums (.valid), formats (email/uuid), pattern, nested objects and arrays', () => {
    const schema = Joi.object({
      email: Joi.string().email(),
      id: Joi.string().guid(),
      code: Joi.string().pattern(/^[A-Z]{3}$/),
      status: Joi.string().valid('new', 'paid'),
      lines: Joi.array().items(Joi.object({ sku: Joi.string() })).min(1),
    });

    const json = joiToJsonSchema(schema);
    const props = json['properties'] as Record<string, Record<string, unknown>>;

    expect(props['email']).toMatchObject({ type: 'string', format: 'email' });
    expect(props['id']).toMatchObject({ type: 'string', format: 'uuid' });
    expect(props['code']).toMatchObject({ type: 'string', pattern: '^[A-Z]{3}$' });
    expect(props['status']).toMatchObject({ type: 'string', enum: ['new', 'paid'] });
    expect(props['lines']).toMatchObject({ type: 'array', minItems: 1 });
    const items = (props['lines'] as Record<string, unknown>)['items'] as Record<string, unknown>;
    expect(items['type']).toBe('object');
  });

  it('maps exclusive number bounds from greater/less', () => {
    const json = joiToJsonSchema(Joi.object({ score: Joi.number().greater(0).less(100) }));
    const score = (json['properties'] as Record<string, Record<string, unknown>>)['score'];
    expect(score).toMatchObject({ type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 100 });
  });

  it('keeps nullability in the OpenAPI 3.0 forms (contract-document.md §4.2)', () => {
    const json = joiToJsonSchema(
      Joi.object({
        note: Joi.string().allow(null).required(),
        child: Joi.object({ name: Joi.string().required() }).allow(null),
        labels: Joi.object().pattern(Joi.string(), Joi.string()),
      }),
    );
    const props = json['properties'] as Record<string, unknown>;
    expect(props['note']).toEqual({ type: 'string', nullable: true });
    expect(props['child']).toEqual({
      type: 'object',
      nullable: true,
      allOf: [{ type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }],
    });
    expect(props['labels']).toEqual({ type: 'object', additionalProperties: { type: 'string' } });
  });

  it('reads the declared schema name from Joi .id() (contract-document.md §4.1 rule 5)', () => {
    expect(joiSchemaName(Joi.object({}).id('OrderItem'))).toBe('OrderItem');
    expect(joiSchemaName(Joi.object({}))).toBeUndefined();
  });
});

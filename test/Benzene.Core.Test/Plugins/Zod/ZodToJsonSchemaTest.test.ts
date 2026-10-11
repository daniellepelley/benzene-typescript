import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from '@benzenejs/zod';

/**
 * Unit tests for `zodToJsonSchema` — the Zod → JSON Schema conversion that lets a service publish a topic's
 * payload schema in its spec/mesh descriptor without runtime type reflection. Verifies shape + validation
 * rules land together, and that the embedded-fragment conventions (no root `$schema`, unrepresentable →
 * unconstrained) hold.
 */
describe('zodToJsonSchema', () => {
  it('emits object shape with required, string min/max, and an optional field', () => {
    const schema = z.object({
      orderId: z.string().min(3).max(10),
      qty: z.number().int().min(1).optional(),
    });

    const json = zodToJsonSchema(schema);

    expect(json['type']).toBe('object');
    const props = json['properties'] as Record<string, Record<string, unknown>>;
    expect(props['orderId']).toMatchObject({ type: 'string', minLength: 3, maxLength: 10 });
    expect(props['qty']).toMatchObject({ type: 'integer', minimum: 1 });
    expect(json['required']).toEqual(['orderId']);
  });

  it('maps enums, formats, nested objects and arrays', () => {
    const schema = z.object({
      email: z.string().email(),
      status: z.enum(['new', 'paid']),
      lines: z.array(z.object({ sku: z.string() })),
    });

    const json = zodToJsonSchema(schema);
    const props = json['properties'] as Record<string, Record<string, unknown>>;

    expect(props['email']).toMatchObject({ type: 'string', format: 'email' });
    expect(props['status']).toMatchObject({ type: 'string', enum: ['new', 'paid'] });
    expect(props['lines']).toMatchObject({ type: 'array' });
    const items = (props['lines'] as Record<string, unknown>)['items'] as Record<string, unknown>;
    expect(items['type']).toBe('object');
    expect((items['properties'] as Record<string, unknown>)['sku']).toMatchObject({ type: 'string' });
  });

  it('strips the root $schema dialect marker (embedded fragment)', () => {
    const json = zodToJsonSchema(z.object({ id: z.string() }));
    expect(json['$schema']).toBeUndefined();
  });

  it('renders an unrepresentable field as unconstrained rather than throwing', () => {
    const schema = z.object({ id: z.string(), big: z.bigint().optional() });

    const json = zodToJsonSchema(schema);
    const props = json['properties'] as Record<string, Record<string, unknown>>;

    expect(props['id']).toMatchObject({ type: 'string' });
    expect(props['big']).toEqual({});
  });

  it('describes a date as the RFC 3339 string it marshals to (contract-document.md §4.2)', () => {
    const props = zodToJsonSchema(z.object({ when: z.date() }))['properties'] as Record<string, unknown>;
    expect(props['when']).toEqual({ type: 'string', format: 'date-time' });
  });

  it('emits the OpenAPI 3.0 nullable forms: nullable primitive, nullable object wrapper', () => {
    const json = zodToJsonSchema(
      z.object({ note: z.string().nullable(), child: z.object({ name: z.string() }).nullable() }),
    );
    const props = json['properties'] as Record<string, unknown>;
    expect(props['note']).toEqual({ type: 'string', nullable: true });
    expect(props['child']).toEqual({
      type: 'object',
      nullable: true,
      allOf: [{ type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }],
    });
    expect(json['required']).toEqual(['note', 'child']);
  });

  it('drops the implicit safe-integer bounds of .int() but keeps declared ones', () => {
    const props = zodToJsonSchema(z.object({ a: z.number().int(), b: z.number().int().min(1) }))[
      'properties'
    ] as Record<string, unknown>;
    expect(props['a']).toEqual({ type: 'integer' });
    expect(props['b']).toEqual({ type: 'integer', minimum: 1 });
  });

  it('returns named sub-schemas under $defs, with the nullable reference wrapper typed', () => {
    const Child = z.object({ name: z.string() }).meta({ id: 'ZodTestChild' });
    const json = zodToJsonSchema(z.object({ child: Child, maybe: Child.nullable() }));
    const props = json['properties'] as Record<string, unknown>;
    expect(props['child']).toEqual({ $ref: '#/$defs/ZodTestChild' });
    expect(props['maybe']).toEqual({ type: 'object', nullable: true, allOf: [{ $ref: '#/$defs/ZodTestChild' }] });
    expect(Object.keys(json['$defs'] as object)).toEqual(['ZodTestChild']);
  });
});

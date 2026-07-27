import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from '@benzene/zod';

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
    const schema = z.object({ id: z.string(), when: z.date().optional() });

    const json = zodToJsonSchema(schema);
    const props = json['properties'] as Record<string, Record<string, unknown>>;

    expect(props['id']).toMatchObject({ type: 'string' });
    expect(props['when']).toEqual({});
  });
});

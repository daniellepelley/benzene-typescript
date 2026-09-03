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

  it('sorts required ordinally regardless of property declaration order (deterministic descriptors)', () => {
    // .NET's MeshSchemaGenerator sorts `required` with StringComparer.Ordinal so the mesh descriptor (and
    // its contract hash) is deterministic; z.toJSONSchema emits it in declaration order, so the adapter
    // must normalize. Nested objects included; `enum` keeps its declared (semantic) order.
    const first = z.object({
      zebra: z.string(),
      apple: z.string(),
      nested: z.object({ delta: z.string(), bravo: z.string() }),
      status: z.enum(['new', 'paid']),
    });
    const second = z.object({
      status: z.enum(['new', 'paid']),
      nested: z.object({ bravo: z.string(), delta: z.string() }),
      apple: z.string(),
      zebra: z.string(),
    });

    const firstJson = zodToJsonSchema(first);
    const secondJson = zodToJsonSchema(second);

    expect(firstJson['required']).toEqual(['apple', 'nested', 'status', 'zebra']);
    const nested = (firstJson['properties'] as Record<string, Record<string, unknown>>)['nested']!;
    expect(nested['required']).toEqual(['bravo', 'delta']);
    expect(secondJson['required']).toEqual(['apple', 'nested', 'status', 'zebra']);
    const status = (firstJson['properties'] as Record<string, Record<string, unknown>>)['status']!;
    expect(status['enum']).toEqual(['new', 'paid']);
  });

  it('renders an unrepresentable field as unconstrained rather than throwing', () => {
    const schema = z.object({ id: z.string(), when: z.date().optional() });

    const json = zodToJsonSchema(schema);
    const props = json['properties'] as Record<string, Record<string, unknown>>;

    expect(props['id']).toMatchObject({ type: 'string' });
    expect(props['when']).toEqual({});
  });
});

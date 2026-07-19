import { describe, expect, it } from 'vitest';
import * as avro from 'avsc';
import { IServiceResolver } from '@benzene/abstractions';
import {
  AvroMediaFormat,
  AvroOptions,
  AvroSchemaRegistry,
  AvroSchemaResolver,
  AvroSerializer,
  Constants,
  getAvroSchema,
  registerAvroSchema,
} from '@benzene/avro';

/**
 * Port of the Benzene.Avro serialization scenarios, adapted to the avsc library and the
 * reflection→registry model (a message class → Avro `Type` association replaces the C# reflection
 * schema generation; see AvroSchemaRegistry).
 */

const orderSchema = {
  type: 'record',
  name: 'Order',
  fields: [{ name: 'orderId', type: 'string' }],
} as const;

class Order {
  constructor(public orderId: string = '') {}
}

function registerOrder(): void {
  registerAvroSchema(Order, avro.Type.forSchema(orderSchema as unknown as avro.Schema));
}

describe('AvroSerializer', () => {
  it('serializeToBytes produces genuine Avro binary (not JSON) and round-trips', () => {
    registerOrder();
    const serializer = new AvroSerializer();
    const order = new Order('42');

    const bytes = serializer.serializeToBytes(order);

    // A Uint8Array of genuine Avro binary.
    expect(bytes).toBeInstanceOf(Uint8Array);

    // NOT the JSON encoding of the payload.
    const jsonBytes = new TextEncoder().encode(JSON.stringify(order));
    expect(Array.from(bytes)).not.toEqual(Array.from(jsonBytes));

    // Matches what avsc itself encodes for the same schema/value.
    const expected = avro.Type.forSchema(orderSchema as unknown as avro.Schema).toBuffer({ orderId: '42' });
    expect(Array.from(bytes)).toEqual(Array.from(expected));

    // Reconstructs the payload from the target class.
    const decoded = serializer.deserializeFromBytes<Order>(bytes, Order);
    expect(decoded).toEqual({ orderId: '42' });
  });

  it('string ISerializer members Base64-armor the Avro bytes (matching the C#)', () => {
    registerOrder();
    const serializer = new AvroSerializer();
    const order = new Order('42');

    const text = serializer.serialize(order);

    // Base64 text of the genuine Avro bytes, not JSON.
    expect(text).not.toContain('{');
    expect(text).toBe(Buffer.from(serializer.serializeToBytes(order)).toString('base64'));

    const decoded = serializer.deserialize<Order>(text, Order);
    expect(decoded).toEqual({ orderId: '42' });
  });

  it('serialize returns empty string for null/undefined and deserialize returns undefined for empty', () => {
    registerOrder();
    const serializer = new AvroSerializer();

    expect(serializer.serialize(undefined)).toBe('');
    expect(serializer.serialize(null)).toBe('');
    expect(serializer.deserialize<Order>('', Order)).toBeUndefined();
    expect(serializer.deserializeFromBytes<Order>(new Uint8Array(0), Order)).toBeUndefined();
  });

  it('deserializeFromBytes throws without a target class (types are erased)', () => {
    registerOrder();
    const serializer = new AvroSerializer();
    const bytes = serializer.serializeToBytes(new Order('7'));

    expect(() => serializer.deserializeFromBytes<Order>(bytes)).toThrow(/target class/);
  });

  it('accepts a plain Avro schema object (compiled lazily) as well as an avro.Type', () => {
    class Plain {
      constructor(public orderId: string = '') {}
    }
    registerAvroSchema(Plain, { type: 'record', name: 'Plain', fields: [{ name: 'orderId', type: 'string' }] });

    const serializer = new AvroSerializer();
    const bytes = serializer.serializeToBytes(new Plain('99'));
    expect(serializer.deserializeFromBytes<Plain>(bytes, Plain)).toEqual({ orderId: '99' });
  });
});

describe('AvroSchemaRegistry', () => {
  it('registers, lazily compiles, and looks up an avro.Type on the global registry', () => {
    class Widget {}
    registerAvroSchema(Widget, { type: 'record', name: 'Widget', fields: [{ name: 'id', type: 'int' }] });

    const type = getAvroSchema(Widget);
    expect(type).toBeInstanceOf(avro.Type);
    // Cached: same compiled Type is returned each call.
    expect(getAvroSchema(Widget)).toBe(type);
  });

  it('returns undefined for a class with no registered schema', () => {
    class Unregistered {}
    expect(getAvroSchema(Unregistered)).toBeUndefined();
  });

  it('supports isolated instances that do not leak into the global registry', () => {
    class Isolated {}
    const registry = new AvroSchemaRegistry();
    registry.register(Isolated, avro.Type.forSchema('string' as unknown as avro.Schema));

    expect(registry.get(Isolated)).toBeInstanceOf(avro.Type);
    expect(getAvroSchema(Isolated)).toBeUndefined();
  });
});

describe('AvroSchemaResolver', () => {
  it('prefers an options-scoped schema over the global registry', () => {
    class Scoped {}
    registerAvroSchema(Scoped, { type: 'record', name: 'GlobalScoped', fields: [{ name: 'id', type: 'int' }] });
    const options = new AvroOptions().registerSchema(Scoped, {
      type: 'record',
      name: 'OptionScoped',
      fields: [{ name: 'id', type: 'string' }],
    });

    const type = new AvroSchemaResolver(options).getSchema(Scoped);
    expect(type.name).toBe('OptionScoped');
  });

  it('throws for an unregistered class (no reflection fallback under type erasure)', () => {
    class NoSchema {}
    expect(() => new AvroSchemaResolver().getSchema(NoSchema)).toThrow(/No Avro schema is registered/);
  });
});

describe('AvroMediaFormat', () => {
  it('exposes the application/avro content type and returns the Avro serializer', () => {
    const serializer = new AvroSerializer();
    const format = new AvroMediaFormat<{ headers: Record<string, string> }>(serializer);

    expect(format.contentType).toBe(Constants.avroContentType);
    expect(format.contentType).toBe('application/avro');
    expect(format.getSerializer(undefined as unknown as IServiceResolver)).toBe(serializer);
  });
});

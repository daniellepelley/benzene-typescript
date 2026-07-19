import { describe, expect, it } from 'vitest';
import { decode, encode } from '@msgpack/msgpack';
import { IServiceResolver } from '@benzene/abstractions';
import {
  Constants,
  MessagePackMediaFormat,
  MessagePackSerializer,
} from '@benzene/messagepack';

/**
 * Port of the Benzene.MessagePack serialization scenarios, adapted to the @msgpack/msgpack library.
 * MessagePack is schemaless (unlike Avro), so there is no registry/resolver — any plain object
 * serializes by its own shape, matching the contractless standard resolver the C# original uses.
 */

class Order {
  constructor(public orderId: string = '') {}
}

describe('MessagePackSerializer', () => {
  it('serializeToBytes produces genuine MessagePack binary (not JSON) and round-trips', () => {
    const serializer = new MessagePackSerializer();
    const order = new Order('42');

    const bytes = serializer.serializeToBytes(order);

    expect(bytes).toBeInstanceOf(Uint8Array);

    // NOT the JSON encoding of the payload.
    const jsonBytes = new TextEncoder().encode(JSON.stringify(order));
    expect(Array.from(bytes)).not.toEqual(Array.from(jsonBytes));

    // Matches what @msgpack/msgpack itself encodes for the same value.
    expect(Array.from(bytes)).toEqual(Array.from(encode({ orderId: '42' })));

    // Reconstructs the payload shape (a plain object, as every Benzene serializer produces).
    const decoded = serializer.deserializeFromBytes<Order>(bytes);
    expect(decoded).toEqual({ orderId: '42' });
  });

  it('string ISerializer members Base64-armor the MessagePack bytes (matching the C#)', () => {
    const serializer = new MessagePackSerializer();
    const order = new Order('42');

    const text = serializer.serialize(order);

    // Base64 text of the genuine MessagePack bytes, not JSON.
    expect(text).not.toContain('{');
    expect(text).toBe(Buffer.from(serializer.serializeToBytes(order)).toString('base64'));

    const decoded = serializer.deserialize<Order>(text);
    expect(decoded).toEqual({ orderId: '42' });
  });

  it('serialize returns empty string for null/undefined and deserialize returns undefined for empty', () => {
    const serializer = new MessagePackSerializer();

    expect(serializer.serialize(undefined)).toBe('');
    expect(serializer.serialize(null)).toBe('');
    expect(serializer.deserialize<Order>('')).toBeUndefined();
    expect(serializer.deserializeFromBytes<Order>(new Uint8Array(0))).toBeUndefined();
  });

  it('the Base64 string path and the raw byte path carry the same MessagePack encoding', () => {
    const serializer = new MessagePackSerializer();
    const order = new Order('7');

    const text = serializer.serialize(order);
    const bytesFromText = new Uint8Array(Buffer.from(text, 'base64'));

    expect(Array.from(bytesFromText)).toEqual(Array.from(serializer.serializeToBytes(order)));
    expect(decode(bytesFromText)).toEqual({ orderId: '7' });
  });
});

describe('MessagePackMediaFormat', () => {
  it('exposes the application/msgpack content type and returns the MessagePack serializer', () => {
    const serializer = new MessagePackSerializer();
    const format = new MessagePackMediaFormat<{ headers: Record<string, string> }>(serializer);

    expect(format.contentType).toBe(Constants.messagePackContentType);
    expect(format.contentType).toBe('application/msgpack');
    expect(format.getSerializer(undefined as unknown as IServiceResolver)).toBe(serializer);
  });
});

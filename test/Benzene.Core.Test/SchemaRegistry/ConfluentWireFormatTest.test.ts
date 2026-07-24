import { describe, expect, it } from 'vitest';
import { ConfluentWireFormat } from '@benzene/schema-registry-core';

/**
 * Port of test/Benzene.Core.Test/SchemaRegistry/ConfluentWireFormatTest.cs. The interop-critical byte
 * framing: magic 0x00 + 4-byte big-endian schema id + body. C#'s `Encoding.UTF8` -> `TextEncoder`; the
 * `IBufferWriter` overload test is dropped (that overload isn't ported - see ConfluentWireFormat).
 */

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('ConfluentWireFormat', () => {
  it('Encode_ProducesMagicByte_BigEndianId_ThenBody', () => {
    const body = utf8('hello');

    const framed = ConfluentWireFormat.encode(258, body); // 258 = 0x00000102

    expect(framed[0]).toBe(ConfluentWireFormat.magicByte);
    expect([...framed.slice(1, 5)]).toEqual([0x00, 0x00, 0x01, 0x02]); // big-endian
    expect([...framed.slice(5)]).toEqual([...body]);
  });

  it('Decode_RecoversIdAndBody_RoundTrip', () => {
    const body = utf8('payload');
    const framed = ConfluentWireFormat.encode(42, body);

    const { schemaId, body: decoded } = ConfluentWireFormat.decode(framed);

    expect(schemaId).toBe(42);
    expect([...decoded]).toEqual([...body]);
  });

  it('Decode_TooShort_Throws', () => {
    expect(() => ConfluentWireFormat.decode(new Uint8Array([0x00, 0x01]))).toThrow();
  });

  it('Decode_WrongMagicByte_Throws', () => {
    const notFramed = new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x01, 0xaa]);
    expect(() => ConfluentWireFormat.decode(notFramed)).toThrow();
  });
});

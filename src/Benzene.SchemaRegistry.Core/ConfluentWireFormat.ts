/** Port of Benzene.SchemaRegistry.Core.ConfluentWireFormat. */

/**
 * The Confluent Schema Registry wire format: a payload is prefixed with a `0x00` magic byte and the
 * 4-byte big-endian schema id, then the serialized body. This is the framing every Confluent Kafka
 * producer/consumer (and Avro/JSON/Protobuf deserializer) expects, so framing Benzene's payloads this
 * way makes them interoperable with the wider Kafka ecosystem.
 *
 * C#'s `ReadOnlySpan<byte>`/`IBufferWriter<byte>` map to `Uint8Array`; the `IBufferWriter` `Encode`
 * overload is unnecessary in the port (the ported serializers model raw `Uint8Array` directly), so only
 * the array-returning `encode`/`decode` are ported. C#'s `out schemaId` becomes a returned object.
 */
export const ConfluentWireFormat = {
  /** The leading magic byte identifying the Confluent wire format. */
  magicByte: 0x00,

  /** The number of framing bytes prepended to the payload (1 magic + 4 id). */
  headerLength: 5,

  /** Frames `payload` with the magic byte and `schemaId`. */
  encode(schemaId: number, payload: Uint8Array): Uint8Array {
    const framed = new Uint8Array(ConfluentWireFormat.headerLength + payload.length);
    framed[0] = ConfluentWireFormat.magicByte;
    new DataView(framed.buffer).setInt32(1, schemaId, false); // false = big-endian
    framed.set(payload, ConfluentWireFormat.headerLength);
    return framed;
  },

  /**
   * Reads the schema id from a framed message and returns it with the body after the 5-byte header.
   * @throws Error if the buffer is too short or doesn't start with the magic byte (C# `FormatException`).
   */
  decode(framed: Uint8Array): { schemaId: number; body: Uint8Array } {
    if (framed.length < ConfluentWireFormat.headerLength) {
      throw new Error(
        `Message is too short to be Confluent-framed (${framed.length} bytes; need at least ${ConfluentWireFormat.headerLength}).`,
      );
    }

    if (framed[0] !== ConfluentWireFormat.magicByte) {
      throw new Error(
        `Message does not start with the Confluent magic byte 0x00 (got 0x${framed[0]!.toString(16).padStart(2, '0').toUpperCase()}).`,
      );
    }

    const schemaId = new DataView(framed.buffer, framed.byteOffset, framed.byteLength).getInt32(1, false);
    return { schemaId, body: framed.subarray(ConfluentWireFormat.headerLength) };
  },
} as const;

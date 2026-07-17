import { IPayloadSerializer, ISerializer } from '@benzene/abstractions';

/**
 * Default ISerializer implementation, backed by JSON. Also implements IPayloadSerializer,
 * so callers with byte-oriented access to the request/response body can skip the
 * intermediate string allocation the ISerializer members require.
 * Port of Benzene.Core.MessageHandlers.Serialization.JsonSerializer.
 *
 * Deviation: the C# implementation configures System.Text.Json with a camelCase
 * property-naming policy and case-insensitive deserialization. Ported types already use
 * camelCase property names (per the porting conventions), so `JSON.stringify`/`JSON.parse`
 * reproduce the same on-the-wire shape without a naming policy, and JSON keys already match
 * exactly (camelCase); no naming/casing option is therefore needed. The C# constructor
 * overload taking custom `JsonSerializerOptions` has no System.Text.Json equivalent in Node
 * and is omitted. The byte-oriented IPayloadSerializer members use `TextEncoder`/
 * `TextDecoder` (UTF-8), matching the C# `Utf8JsonWriter`/`Utf8JsonReader` path.
 */
export class JsonSerializer implements ISerializer, IPayloadSerializer {
  /** Port of C# `string Serialize<T>(T payload)`. */
  serialize<T>(payload: T): string {
    return JSON.stringify(payload);
  }

  /** Port of C# `T? Deserialize<T>(string payload)`. */
  deserialize<T>(payload: string): T | undefined {
    return JSON.parse(payload) as T;
  }

  /** Port of C# `void Serialize(Type, object, IBufferWriter<byte>)`. */
  serializeToBytes<T>(payload: T): Uint8Array {
    return new TextEncoder().encode(this.serialize(payload));
  }

  /** Port of C# `object? Deserialize(Type, ReadOnlySpan<byte>)`. */
  deserializeFromBytes<T>(payload: Uint8Array): T | undefined {
    return this.deserialize<T>(new TextDecoder().decode(payload));
  }
}

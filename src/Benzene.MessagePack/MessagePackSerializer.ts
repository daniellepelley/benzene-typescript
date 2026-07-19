/** Port of Benzene.MessagePack.MessagePackSerializer. */
import { IPayloadSerializer, ISerializer } from '@benzene/abstractions';
import { decode, encode } from '@msgpack/msgpack';

/**
 * MessagePack {@link IPayloadSerializer} adapting the `@msgpack/msgpack` library.
 * Port of Benzene.MessagePack.MessagePackSerializer.
 *
 * **`@msgpack/msgpack` mapping.** The C# original wraps MessagePack-CSharp with its contractless
 * standard resolver so plain POCOs serialize by their public properties without a declared contract.
 * `@msgpack/msgpack` is schemaless by nature — `encode(value)` / `decode(bytes)` work on any plain
 * object — so there is no resolver to port and no per-type registration (unlike {@link AvroSerializer},
 * which needs a schema per class). This matches the "just works on any object" expectation the built-in
 * `JsonSerializer` already meets.
 *
 * **String vs byte members.** The wire form is genuine MessagePack binary. Mirroring the C#
 * `MessagePackSerializer`, the string {@link ISerializer} members Base64-armor those bytes
 * (`serialize` → Base64 text, `deserialize` consumes it) so MessagePack flows unchanged through every
 * string-bodied transport (all four HTTP transports, SQS, BenzeneMessage, …). Deliberate, documented
 * deviation from C#, identical to the {@link AvroSerializer} port: the ported {@link IPayloadSerializer}
 * already models a raw `Uint8Array`, so the byte members here carry *genuine MessagePack binary* rather
 * than the C# byte path's "UTF-8 bytes of the Base64 text" (the .NET byte members only re-encoded Base64
 * because no .NET transport carried true binary). The byte path is thus the natural raw-msgpack carrier;
 * the string path stays Base64 for string transports.
 *
 * **Decode return typing.** `decode` returns `unknown` (the wire form has no runtime type identity), so
 * the deserialize members assert to `T`. The decoded value is a plain object with the message's own
 * property shape — the same reconstruction the JSON path produces — not an instance of the message
 * class; this matches every other Benzene serializer.
 */
export class MessagePackSerializer implements ISerializer, IPayloadSerializer {
  /** Port of C# `string Serialize<T>(T payload)` — Base64 of the MessagePack bytes (empty for null/undefined). */
  serialize<T>(payload: T): string {
    if (payload === undefined || payload === null) {
      return '';
    }
    return Buffer.from(this.serializeToBytes(payload)).toString('base64');
  }

  /** Port of C# `T? Deserialize<T>(string payload)` — consumes the Base64 produced by {@link serialize}. */
  deserialize<T>(payload: string): T | undefined {
    if (payload === undefined || payload === null || payload === '') {
      return undefined;
    }
    return this.deserializeFromBytes<T>(new Uint8Array(Buffer.from(payload, 'base64')));
  }

  /**
   * Port of C# `void Serialize(Type, object, IBufferWriter<byte>)` — genuine MessagePack binary
   * (see class remarks).
   */
  serializeToBytes<T>(payload: T): Uint8Array {
    if (payload === undefined || payload === null) {
      return new Uint8Array(0);
    }
    return encode(payload);
  }

  /** Port of C# `object? Deserialize(Type, ReadOnlySpan<byte>)` — genuine MessagePack binary. */
  deserializeFromBytes<T>(payload: Uint8Array): T | undefined {
    if (payload === undefined || payload === null || payload.length === 0) {
      return undefined;
    }
    return decode(payload) as T;
  }
}

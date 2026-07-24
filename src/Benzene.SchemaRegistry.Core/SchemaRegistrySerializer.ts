/** Port of Benzene.SchemaRegistry.Core.SchemaRegistrySerializer. */
import { Constructor, IPayloadSerializer, ISerializer } from '@benzene/abstractions';
import { ConfluentWireFormat } from './ConfluentWireFormat';

/**
 * An {@link IPayloadSerializer} decorator that frames an inner serializer's output with the Confluent
 * wire format (magic byte + schema id), so a Benzene producer's messages carry the schema id the wider
 * Kafka ecosystem resolves the writer schema from. Works over ANY inner payload serializer (Avro, JSON,
 * MessagePack) - it adds the registry framing, not a format.
 * Port of Benzene.SchemaRegistry.Core.SchemaRegistrySerializer.
 *
 * Schema ids are resolved once, at startup, into the id map this is constructed with (see
 * {@link SchemaRegistrar}), so serialization stays synchronous. Serializing a type with no registered id
 * throws, surfacing a missing startup registration immediately. Like `@benzene/avro`, the string members
 * Base64-armor the framed bytes so the serializer also flows through string-body pipelines unchanged.
 *
 * Erasure: C#'s explicit `Type` parameter is recovered from the payload's `constructor` on the serialize
 * path (`(payload).constructor`); the deserialize path adds an optional `targetType` (the erased `T`)
 * that is forwarded to the inner serializer - mirroring `@benzene/avro`'s deserialize members.
 */
export class SchemaRegistrySerializer implements ISerializer, IPayloadSerializer {
  constructor(
    private readonly inner: IPayloadSerializer,
    private readonly schemaIds: ReadonlyMap<Constructor<unknown>, number>,
  ) {}

  /** Port of C# `string Serialize<T>(T payload)` - Base64 of the framed bytes (empty for null/undefined). */
  serialize<T>(payload: T): string {
    if (payload === undefined || payload === null) {
      return '';
    }
    return Buffer.from(this.serializeToBytes(payload)).toString('base64');
  }

  /**
   * Port of C# `T? Deserialize<T>(string payload)` - consumes the Base64 produced by {@link serialize}.
   * `targetType` supplies the erased `T` for the inner serializer (required by e.g. Avro).
   */
  deserialize<T>(payload: string, targetType?: Constructor<T>): T | undefined {
    if (payload === undefined || payload === null || payload === '') {
      return undefined;
    }
    return this.deserializeFromBytes<T>(new Uint8Array(Buffer.from(payload, 'base64')), targetType);
  }

  /** Port of C# `void Serialize(Type, object, IBufferWriter<byte>)` - frames the inner body with the resolved id. */
  serializeToBytes<T>(payload: T): Uint8Array {
    if (payload === undefined || payload === null) {
      return new Uint8Array(0);
    }
    const type = (payload as object).constructor as Constructor<unknown>;
    const body = this.inner.serializeToBytes(payload);
    return ConfluentWireFormat.encode(this.schemaIdFor(type), body);
  }

  /** Port of C# `object? Deserialize(Type, ReadOnlySpan<byte>)` - strips the frame, then defers to the inner serializer. */
  deserializeFromBytes<T>(payload: Uint8Array, targetType?: Constructor<T>): T | undefined {
    if (payload === undefined || payload === null || payload.length === 0) {
      return undefined;
    }
    const { body } = ConfluentWireFormat.decode(payload);
    // The inner serializer may need the erased target class (e.g. Avro); the ported IPayloadSerializer
    // signature has no such parameter, so forward it through a widened call, matching @benzene/avro.
    const innerDeserialize = this.inner.deserializeFromBytes.bind(this.inner) as (
      p: Uint8Array,
      t?: Constructor<T>,
    ) => T | undefined;
    return innerDeserialize(body, targetType);
  }

  private schemaIdFor(type: Constructor<unknown>): number {
    const id = this.schemaIds.get(type);
    if (id === undefined) {
      throw new Error(
        `No schema id is registered for '${type.name}'. Register its schema at startup via SchemaRegistrar before serializing.`,
      );
    }
    return id;
  }
}

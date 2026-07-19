/** Port of Benzene.Avro.AvroSerializer. */
import { Constructor, IPayloadSerializer, ISerializer } from '@benzene/abstractions';
import { AvroOptions } from './AvroOptions';
import { AvroSchemaResolver } from './AvroSchemaResolver';
import { IAvroSchemaResolver } from './IAvroSchemaResolver';

/** Narrows the constructor argument: an already-built resolver exposes `getSchema`. */
function isResolver(value: IAvroSchemaResolver | AvroOptions): value is IAvroSchemaResolver {
  return typeof (value as IAvroSchemaResolver).getSchema === 'function';
}

/**
 * Apache Avro {@link IPayloadSerializer} adapting the avsc library.
 * Port of Benzene.Avro.AvroSerializer.
 *
 * **avsc mapping.** The schema is resolved to an `avro.Type` (see {@link AvroSchemaResolver}); avsc's
 * `type.toBuffer(value)` / `type.fromBuffer(buffer)` do the genuine Avro binary encode/decode directly
 * against plain objects, so the C# `AvroDatumConverter` (POCO ↔ `GenericRecord`) and
 * `GenericDatumWriter`/`Reader` plumbing are subsumed and not ported.
 *
 * **Reflection → registry / erasure handling.** The C# members take a runtime `Type`; here the schema
 * is resolved from the message *class* — the payload's `constructor` on the serialize path, and an
 * explicit target class on the deserialize path (types are erased, so `Deserialize<T>`'s `typeof(T)`
 * has no runtime value). The deserialize members therefore add an optional target-class argument; they
 * remain assignable to the ported `IPayloadSerializer`/`ISerializer`.
 *
 * **String vs byte members.** The wire form is genuine Avro binary. Mirroring the C# `AvroSerializer`,
 * the string `ISerializer` members Base64-armor those bytes (`serialize` → Base64 text, `deserialize`
 * consumes it) so Avro flows unchanged through every string-bodied transport. Deliberate, documented
 * deviation from C#: the ported `IPayloadSerializer` already models a raw `Uint8Array`, so the byte
 * members here carry *genuine Avro binary* rather than the C# path's "UTF-8 bytes of the Base64 text"
 * (the .NET byte members only re-encoded Base64 because no .NET transport carried true binary). The
 * byte path is thus the natural raw-Avro carrier; the string path stays Base64 for string transports.
 */
export class AvroSerializer implements ISerializer, IPayloadSerializer {
  private readonly schemaResolver: IAvroSchemaResolver;

  /**
   * Initializes a new instance. Port of the C# constructor trio: pass an {@link IAvroSchemaResolver},
   * an {@link AvroOptions} (a resolver is built from it), or nothing (default options).
   */
  constructor(schemaResolverOrOptions: IAvroSchemaResolver | AvroOptions = new AvroOptions()) {
    this.schemaResolver = isResolver(schemaResolverOrOptions)
      ? schemaResolverOrOptions
      : new AvroSchemaResolver(schemaResolverOrOptions);
  }

  /** Port of C# `string Serialize<T>(T payload)` — Base64 of the Avro bytes (empty for null/undefined). */
  serialize<T>(payload: T): string {
    if (payload === undefined || payload === null) {
      return '';
    }
    return Buffer.from(this.serializeToBytes(payload)).toString('base64');
  }

  /**
   * Port of C# `T? Deserialize<T>(string payload)` — consumes the Base64 produced by {@link serialize}.
   * `targetType` supplies the erased `T` so the schema can be resolved (the C# `typeof(T)` has no
   * runtime value); required for a non-empty payload.
   */
  deserialize<T>(payload: string, targetType?: Constructor<T>): T | undefined {
    if (payload === undefined || payload === null || payload === '') {
      return undefined;
    }
    return this.deserializeFromBytes<T>(new Uint8Array(Buffer.from(payload, 'base64')), targetType);
  }

  /**
   * Port of C# `void Serialize(Type, object, IBufferWriter<byte>)` — genuine Avro binary (see class
   * remarks). Resolves the schema from the payload's `constructor`.
   */
  serializeToBytes<T>(payload: T): Uint8Array {
    if (payload === undefined || payload === null) {
      return new Uint8Array(0);
    }
    const type = this.schemaResolver.getSchema((payload as object).constructor as Constructor<unknown>);
    return Uint8Array.from(type.toBuffer(payload));
  }

  /**
   * Port of C# `object? Deserialize(Type, ReadOnlySpan<byte>)` — genuine Avro binary. `targetType`
   * supplies the erased target class used to resolve the schema; required for a non-empty payload.
   */
  deserializeFromBytes<T>(payload: Uint8Array, targetType?: Constructor<T>): T | undefined {
    if (payload === undefined || payload === null || payload.length === 0) {
      return undefined;
    }
    if (targetType === undefined) {
      throw new Error(
        'AvroSerializer requires the target class to deserialize: types are erased at runtime, so the ' +
          'Avro schema cannot be resolved without it. Pass the message class, e.g. ' +
          'deserializeFromBytes(bytes, Order).',
      );
    }
    const type = this.schemaResolver.getSchema(targetType as Constructor<unknown>);
    return type.fromBuffer(Buffer.from(payload)) as T;
  }
}

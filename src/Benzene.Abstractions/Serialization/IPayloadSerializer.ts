import { ServiceToken, serviceToken } from '../DI/ServiceToken';
import { ISerializer } from './ISerializer';

/**
 * A serializer that can additionally read and write binary payloads.
 * Port of Benzene.Abstractions.Serialization.IPayloadSerializer
 * (C# `IBufferWriter<byte>`/`ReadOnlySpan<byte>` map to `Uint8Array`).
 */
export interface IPayloadSerializer extends ISerializer {
  /** Port of C# `void Serialize(Type, object, IBufferWriter<byte>)`. */
  serializeToBytes<T>(payload: T): Uint8Array;

  /** Port of C# `object? Deserialize(Type, ReadOnlySpan<byte>)`. */
  deserializeFromBytes<T>(payload: Uint8Array): T | undefined;
}

export const IPayloadSerializer: ServiceToken<IPayloadSerializer> =
  serviceToken<IPayloadSerializer>('IPayloadSerializer');

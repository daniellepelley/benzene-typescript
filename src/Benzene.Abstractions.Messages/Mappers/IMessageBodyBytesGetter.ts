import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Optional byte-oriented companion to `IMessageBodyGetter<TContext>`: exposes the raw message body
 * as bytes for transports that already hold it that way, so an `IPayloadSerializer` can deserialize
 * without an intermediate string allocation.
 * Port of Benzene.Abstractions.Messages.Mappers.IMessageBodyBytesGetter&lt;TContext&gt;
 * (C# `ReadOnlyMemory<byte>` maps to `Uint8Array`).
 */
export interface IMessageBodyBytesGetter<TContext> {
  /** Port of C# `ReadOnlyMemory<byte> GetBodyBytes(TContext)`; empty body maps to an empty `Uint8Array`. */
  getBodyBytes(context: TContext): Uint8Array;
}

export const IMessageBodyBytesGetter: ServiceToken<IMessageBodyBytesGetter<unknown>> =
  serviceToken<IMessageBodyBytesGetter<unknown>>('IMessageBodyBytesGetter');

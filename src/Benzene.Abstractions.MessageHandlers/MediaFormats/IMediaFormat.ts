import { IServiceResolver, ISerializer, ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * A single wire format (e.g. JSON, XML) available for both reading requests and writing responses.
 * One registration drives both directions of content negotiation via `IMediaFormatNegotiator`.
 * Port of Benzene.Abstractions.MessageHandlers.MediaFormats.IMediaFormat&lt;TContext&gt;.
 */
export interface IMediaFormat<TContext> {
  /** The media type this format produces on the response side (e.g. `"application/xml"`). */
  readonly contentType: string;

  /** Whether this format should deserialize the incoming request body. Port of C# `CanRead`. */
  canRead(context: TContext, serviceResolver: IServiceResolver): boolean;

  /** Whether this format should serialize the outgoing response. Port of C# `CanWrite`. */
  canWrite(context: TContext, serviceResolver: IServiceResolver): boolean;

  /** Resolves the serializer this format uses to read/write its wire representation. Port of C# `GetSerializer`. */
  getSerializer(serviceResolver: IServiceResolver): ISerializer;
}

export const IMediaFormat: ServiceToken<IMediaFormat<unknown>> =
  serviceToken<IMediaFormat<unknown>>('IMediaFormat');

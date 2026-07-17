import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { IMediaFormat } from './IMediaFormat';

/**
 * Selects which registered `IMediaFormat<TContext>` to use for reading the current message's request
 * body and for writing its response, evaluating each format's applicability exactly once per message
 * (a scoped implementation memoizes both decisions).
 * Port of Benzene.Abstractions.MessageHandlers.MediaFormats.IMediaFormatNegotiator&lt;TContext&gt;.
 */
export interface IMediaFormatNegotiator<TContext> {
  /** Selects the format to deserialize the request body with, falling back to JSON. Port of C# `SelectRead`. */
  selectRead(context: TContext): IMediaFormat<TContext>;

  /** Selects the format to serialize the response with, falling back to `selectRead`. Port of C# `SelectWrite`. */
  selectWrite(context: TContext): IMediaFormat<TContext>;
}

export const IMediaFormatNegotiator: ServiceToken<IMediaFormatNegotiator<unknown>> =
  serviceToken<IMediaFormatNegotiator<unknown>>('IMediaFormatNegotiator');

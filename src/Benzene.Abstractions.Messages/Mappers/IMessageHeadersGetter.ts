import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Extracts the headers from a transport-specific message context.
 * Port of Benzene.Abstractions.Messages.Mappers.IMessageHeadersGetter&lt;TContext&gt;.
 */
export interface IMessageHeadersGetter<TContext> {
  /** Port of C# `IDictionary<string, string> GetHeaders(TContext)`. */
  getHeaders(context: TContext): Record<string, string>;
}

export const IMessageHeadersGetter: ServiceToken<IMessageHeadersGetter<unknown>> =
  serviceToken<IMessageHeadersGetter<unknown>>('IMessageHeadersGetter');

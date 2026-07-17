import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Extracts the raw body from a transport-specific message context.
 * Port of Benzene.Abstractions.Messages.Mappers.IMessageBodyGetter&lt;TContext&gt;.
 */
export interface IMessageBodyGetter<TContext> {
  /** Port of C# `string? GetBody(TContext)`; C# `null` maps to `undefined`. */
  getBody(context: TContext): string | undefined;
}

export const IMessageBodyGetter: ServiceToken<IMessageBodyGetter<unknown>> =
  serviceToken<IMessageBodyGetter<unknown>>('IMessageBodyGetter');

import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Writes the raw body onto a transport-specific message context.
 * Port of Benzene.Abstractions.Messages.Mappers.IMessageBodySetter&lt;TContext&gt;
 * (C# `Task` maps to `Promise<void>`).
 */
export interface IMessageBodySetter<TContext> {
  /** Port of C# `Task SetBody(TContext, string body)`. */
  setBody(context: TContext, body: string): Promise<void>;
}

export const IMessageBodySetter: ServiceToken<IMessageBodySetter<unknown>> =
  serviceToken<IMessageBodySetter<unknown>>('IMessageBodySetter');

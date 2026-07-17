import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Writes the headers onto a transport-specific message context.
 * Port of Benzene.Abstractions.Messages.Mappers.IMessageHeadersSetter&lt;TContext&gt;
 * (C# `IDictionary<string, string>` maps to `Record<string, string>`; `Task` to `Promise<void>`).
 */
export interface IMessageHeadersSetter<TContext> {
  /** Port of C# `Task SetHeaders(TContext, IDictionary<string, string> headers)`. */
  setHeaders(context: TContext, headers: Record<string, string>): Promise<void>;
}

export const IMessageHeadersSetter: ServiceToken<IMessageHeadersSetter<unknown>> =
  serviceToken<IMessageHeadersSetter<unknown>>('IMessageHeadersSetter');

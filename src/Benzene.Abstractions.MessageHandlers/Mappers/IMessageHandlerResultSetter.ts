import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { IMessageHandlerResult } from '../IMessageHandlerResult';

/**
 * Writes a handler's outcome back out through the transport (e.g. an HTTP response, a queue
 * acknowledgement flag, or nothing for fire-and-forget). Despite the "Setter" name, implementations
 * perform the transport-specific side effect of delivering the result.
 * Port of Benzene.Abstractions.MessageHandlers.Mappers.IMessageHandlerResultSetter&lt;TContext&gt;.
 */
export interface IMessageHandlerResultSetter<TContext> {
  /** Applies the handler's result to the given transport context. Port of C# `SetResultAsync`. */
  setResultAsync(
    context: TContext,
    messageHandlerResult: IMessageHandlerResult,
  ): Promise<void>;
}

export const IMessageHandlerResultSetter: ServiceToken<IMessageHandlerResultSetter<unknown>> =
  serviceToken<IMessageHandlerResultSetter<unknown>>('IMessageHandlerResultSetter');

import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { IMessageHandlerResult } from '../IMessageHandlerResult';

/**
 * Runs every registered `IResponseHandler<TContext>` against a handler's result to build the
 * outgoing response, then finalizes it via `IBenzeneResponseAdapter<TContext>`.
 * Port of Benzene.Abstractions.MessageHandlers.Response.IResponseHandlerContainer&lt;TContext&gt;.
 */
export interface IResponseHandlerContainer<TContext> {
  /** Runs all registered response handlers for the given result, then finalizes. Port of C# `HandleAsync`. */
  handleAsync(context: TContext, messageHandlerResult: IMessageHandlerResult): Promise<void>;
}

export const IResponseHandlerContainer: ServiceToken<IResponseHandlerContainer<unknown>> =
  serviceToken<IResponseHandlerContainer<unknown>>('IResponseHandlerContainer');

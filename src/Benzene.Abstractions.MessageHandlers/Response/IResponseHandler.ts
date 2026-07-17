import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { IMessageHandlerResult } from '../IMessageHandlerResult';

/**
 * One piece of response processing plugged into an `IResponseHandlerContainer<TContext>` (e.g.
 * writing the response body, setting a status code), run in registration order against a handler's
 * result.
 * Port of Benzene.Abstractions.MessageHandlers.Response.IResponseHandler&lt;TContext&gt;
 * (C# `ValueTask` maps to `Promise<void>`).
 */
export interface IResponseHandler<TContext> {
  /** Processes the handler's result against the transport context. Port of C# `HandleAsync`. */
  handleAsync(context: TContext, messageHandlerResult: IMessageHandlerResult): Promise<void>;
}

export const IResponseHandler: ServiceToken<IResponseHandler<unknown>> =
  serviceToken<IResponseHandler<unknown>>('IResponseHandler');

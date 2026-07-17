import { IBenzeneResultOf } from '@benzene/abstractions';

/**
 * The core message handler contract: handles a request and produces a result-wrapped response.
 * Port of Benzene.Abstractions.MessageHandlers.IMessageHandlerBase&lt;TRequest, TResponse&gt;.
 */
export interface IMessageHandlerBase<TRequest, TResponse> {
  handleAsync(request: TRequest): Promise<IBenzeneResultOf<TResponse>>;
}

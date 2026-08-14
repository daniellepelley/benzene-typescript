import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler, IMessageHandlerNoResponse } from '@benzenejs/abstractions-message-handlers';
import { BenzeneResult } from '@benzenejs/results';

/**
 * Adapts a no-response handler to the request/response handler shape, returning
 * Accepted after it completes.
 * Port of Benzene.Core.MessageHandlers.MessageHandlerNoResultWrapper&lt;TRequest, TResponse&gt;.
 */
export class MessageHandlerNoResultWrapper<TRequest, TResponse>
  implements IMessageHandler<TRequest, TResponse>
{
  constructor(private readonly inner: IMessageHandlerNoResponse<TRequest>) {}

  async handleAsync(request: TRequest): Promise<IBenzeneResultOf<TResponse>> {
    await this.inner.handleAsync(request);
    return BenzeneResult.accepted<TResponse>();
  }
}

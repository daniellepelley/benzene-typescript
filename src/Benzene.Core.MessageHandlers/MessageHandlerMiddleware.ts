import { IMessageHandler, IMessageHandlerContext } from '@benzene/abstractions-message-handlers';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';

/**
 * The terminal middleware in a handler's pipeline (see `HandlerPipelineBuilder`): invokes the
 * strongly-typed handler and assigns its result onto the context's `response`. Always appended as
 * the last step, so it does not call `next`.
 * Port of Benzene.Core.MessageHandlers.MessageHandlerMiddleware&lt;TRequest, TResponse&gt;.
 */
export class MessageHandlerMiddleware<TRequest, TResponse>
  implements IMiddleware<IMessageHandlerContext<TRequest, TResponse>>
{
  constructor(private readonly messageHandler: IMessageHandler<TRequest, TResponse>) {}

  readonly name = 'MessageHandler';

  async handleAsync(
    context: IMessageHandlerContext<TRequest, TResponse>,
    _next: NextFunc,
  ): Promise<void> {
    context.response = await this.messageHandler.handleAsync(context.request);
  }
}

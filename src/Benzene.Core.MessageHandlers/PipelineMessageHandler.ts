import { Constructor, IBenzeneResultOf, IServiceResolver } from '@benzene/abstractions';
import { IMessageHandler, IMessageHandlerContext } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { MessageHandlerContext } from './BenzeneMessageContext';

/**
 * Presents a handler middleware pipeline (built by `HandlerPipelineBuilder`) as a plain
 * `IMessageHandler<TRequest, TResponse>`, so callers don't need to know that middleware runs around
 * the handler. Each call creates a fresh `MessageHandlerContext` and runs it through the pipeline;
 * the pipeline's terminal `MessageHandlerMiddleware` invokes the actual handler and stores the
 * response back onto that context.
 * Port of Benzene.Core.MessageHandlers.PipelineMessageHandler&lt;TRequest, TResponse&gt;.
 */
export class PipelineMessageHandler<TRequest, TResponse>
  implements IMessageHandler<TRequest, TResponse>
{
  constructor(
    private readonly topic: ITopic,
    private readonly pipeline: IMiddlewarePipeline<IMessageHandlerContext<TRequest, TResponse>>,
    private readonly serviceResolver: IServiceResolver,
    private readonly handlerType?: Constructor<unknown>,
  ) {}

  async handleAsync(request: TRequest): Promise<IBenzeneResultOf<TResponse>> {
    const context = new MessageHandlerContext<TRequest, TResponse>(
      this.topic,
      request,
      this.handlerType,
    );
    await this.pipeline.handleAsync(context, this.serviceResolver);
    return context.response;
  }
}

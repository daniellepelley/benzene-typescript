import { Constructor, IServiceResolver } from '@benzene/abstractions';
import {
  IHandlerPipelineBuilder,
  IMessageHandler,
  IMessageHandlerNoResponse,
  IMessageHandlerWrapper,
} from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { MessageHandlerNoResultWrapper } from './MessageHandlerNoResultWrapper';
import { PipelineMessageHandler } from './PipelineMessageHandler';

/**
 * Default `IMessageHandlerWrapper` implementation: builds the handler's middleware pipeline via
 * `IHandlerPipelineBuilder` and returns it as a `PipelineMessageHandler`, wrapping no-response
 * handlers with `MessageHandlerNoResultWrapper` first so both handler shapes go through the same
 * pipeline machinery.
 * Port of Benzene.Core.MessageHandlers.PipelineMessageHandlerWrapper (the two C# `Wrap` overloads
 * split by name — `wrap` / `wrapNoResponse` — matching the ported `IMessageHandlerWrapper`).
 */
export class PipelineMessageHandlerWrapper implements IMessageHandlerWrapper {
  constructor(
    private readonly handlerPipelineBuilder: IHandlerPipelineBuilder,
    private readonly serviceResolver: IServiceResolver,
  ) {}

  wrap<TRequest, TResponse>(
    topic: ITopic,
    messageHandler: IMessageHandler<TRequest, TResponse>,
  ): IMessageHandler<TRequest, TResponse> {
    const pipeline = this.handlerPipelineBuilder.create(messageHandler, this.serviceResolver);
    return new PipelineMessageHandler<TRequest, TResponse>(
      topic,
      pipeline,
      this.serviceResolver,
      (messageHandler as object).constructor as Constructor<unknown>,
    );
  }

  wrapNoResponse<TRequest, TResponse>(
    topic: ITopic,
    messageHandler: IMessageHandlerNoResponse<TRequest>,
  ): IMessageHandler<TRequest, TResponse> {
    const wrapped = new MessageHandlerNoResultWrapper<TRequest, TResponse>(messageHandler);
    const pipeline = this.handlerPipelineBuilder.create(wrapped, this.serviceResolver);
    return new PipelineMessageHandler<TRequest, TResponse>(
      topic,
      pipeline,
      this.serviceResolver,
      (messageHandler as object).constructor as Constructor<unknown>,
    );
  }
}

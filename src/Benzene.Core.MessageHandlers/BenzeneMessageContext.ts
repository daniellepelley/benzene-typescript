import { Constructor, IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandlerContext } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { BenzeneResult } from '@benzene/results';

/**
 * Default `IMessageHandlerContext<TRequest, TResponse>` implementation: the per-invocation context
 * flowing through a handler's middleware pipeline, created fresh for each call by
 * `PipelineMessageHandler<TRequest, TResponse>`.
 *
 * Port of Benzene.Core.MessageHandlers.BenzeneMessageContext — the file is named
 * `BenzeneMessageContext` to mirror the C# source, but the class it defines is
 * `MessageHandlerContext<TRequest, TResponse>` (the C# quirk is preserved). `response` starts out
 * as an unexpected-error result so a pipeline that never reaches the terminal handler middleware
 * still ends with a defined result.
 */
export class MessageHandlerContext<TRequest, TResponse>
  implements IMessageHandlerContext<TRequest, TResponse>
{
  readonly topic: ITopic;

  readonly handlerType: Constructor<unknown> | undefined;

  readonly request: TRequest;

  response: IBenzeneResultOf<TResponse>;

  constructor(topic: ITopic, request: TRequest, handlerType?: Constructor<unknown>) {
    this.topic = topic;
    this.request = request;
    this.handlerType = handlerType;
    this.response = BenzeneResult.unexpectedError<TResponse>();
  }
}

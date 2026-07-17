import { IBenzeneResult, IBenzeneResultOf, IServiceResolver, VoidResult } from '@benzene/abstractions';
import {
  IBenzeneClientContext,
  IGetTopic,
  IMessageSender,
  IMessageSenderNoResponse,
} from '@benzene/abstractions-messages';
import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { BenzeneClientContext } from './BenzeneClientContext';
import { BenzeneClientRequest } from './BenzeneClientRequest';

/**
 * Sends an outbound message by running it through a client middleware pipeline and returning the
 * `Response` the pipeline set on the context.
 * Port of Benzene.Core.Messages.MessageSender.MessageSender&lt;TRequest, TResponse&gt;.
 */
export class MessageSender<TRequest, TResponse> implements IMessageSender<TRequest, TResponse> {
  constructor(
    private readonly middlewarePipeline: IMiddlewarePipeline<IBenzeneClientContext<TRequest, TResponse>>,
    private readonly getTopic: IGetTopic,
    private readonly serviceResolver: IServiceResolver,
  ) {}

  async sendMessageAsync(request: TRequest): Promise<IBenzeneResultOf<TResponse>> {
    // C# `_getTopic.GetTopic(typeof(TRequest))`; the runtime request type is erased in TypeScript,
    // so no type argument is passed (see IGetTopic's deviation note).
    const topic = this.getTopic.getTopic();
    const context = new BenzeneClientContext<TRequest, TResponse>(
      new BenzeneClientRequest<TRequest>(topic, request, {}),
    );
    await this.middlewarePipeline.handleAsync(context, this.serviceResolver);
    return context.response;
  }
}

/**
 * The no-response sender: delegates to a `MessageSender<TMessage, VoidResult>` and exposes only the
 * status.
 * Port of Benzene.Core.Messages.MessageSender.MessageSender&lt;TMessage&gt;.
 *
 * Arity collision: C# has two classes named `MessageSender` (one/two type args). Mirroring the
 * `IMessageSenderNoResponse` / `IMessageHandlerNoResponse` precedent, the one-arg class is renamed
 * `MessageSenderNoResponse`. C# `Void` maps to `VoidResult`.
 */
export class MessageSenderNoResponse<TMessage> implements IMessageSenderNoResponse<TMessage> {
  private readonly inner: MessageSender<TMessage, VoidResult>;

  constructor(
    middlewarePipeline: IMiddlewarePipeline<IBenzeneClientContext<TMessage, VoidResult>>,
    getTopic: IGetTopic,
    serviceResolver: IServiceResolver,
  ) {
    this.inner = new MessageSender<TMessage, VoidResult>(middlewarePipeline, getTopic, serviceResolver);
  }

  async sendMessageAsync(message: TMessage): Promise<IBenzeneResult> {
    return this.inner.sendMessageAsync(message);
  }
}

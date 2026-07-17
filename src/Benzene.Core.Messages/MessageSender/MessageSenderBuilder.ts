import { IRegisterDependency, tryAddScoped, tryAddScopedFactory, VoidResult } from '@benzene/abstractions';
import {
  IBenzeneClientContext,
  IGetTopic,
  IMessageSender,
  IMessageSenderNoResponse,
} from '@benzene/abstractions-messages';
import { PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { createMiddlewarePipeline } from '@benzene/core-middleware';
import { DefaultGetTopic } from './DefaultGetTopic';
import { IMessageSenderBuilder } from './IMessageSenderBuilder';
import { MessageSender, MessageSenderNoResponse } from './MessageSender';

/**
 * Builds and registers outbound senders: for each `createSender` call it builds a standalone client
 * middleware pipeline and registers the matching `IMessageSender(NoResponse)` plus the default
 * `IGetTopic`.
 * Port of Benzene.Core.Messages.MessageSender.MessageSenderBuilder.
 *
 * The C# `TryAddScoped(_ => pipeline)` (registering the built pipeline so `MessageSender` can resolve
 * it) has no faithful token in TypeScript, because the pipeline's generic context type is erased and
 * cannot key a registration. Instead each sender is registered by a factory closing over its built
 * pipeline directly — the same instance C# would have resolved — so no per-context pipeline token is
 * needed.
 */
export class MessageSenderBuilder implements IMessageSenderBuilder {
  constructor(private readonly registerDependency: IRegisterDependency) {}

  createSender<TMessage>(action: PipelineBuilderAction<IBenzeneClientContext<TMessage, VoidResult>>): void {
    const pipeline = createMiddlewarePipeline(this.registerDependency, action);

    this.registerDependency.register((x) => {
      tryAddScopedFactory(
        x,
        IMessageSenderNoResponse,
        (resolver) =>
          new MessageSenderNoResponse<TMessage>(
            pipeline,
            resolver.getService(IGetTopic),
            resolver,
          ) as IMessageSenderNoResponse<unknown>,
      );
      tryAddScoped(x, IGetTopic, DefaultGetTopic);
    });
  }

  createSenderWithResponse<TRequest, TResponse>(
    action: PipelineBuilderAction<IBenzeneClientContext<TRequest, TResponse>>,
  ): void {
    const pipeline = createMiddlewarePipeline(this.registerDependency, action);

    this.registerDependency.register((x) => {
      tryAddScopedFactory(
        x,
        IMessageSender,
        (resolver) =>
          new MessageSender<TRequest, TResponse>(
            pipeline,
            resolver.getService(IGetTopic),
            resolver,
          ) as IMessageSender<unknown, unknown>,
      );
      tryAddScoped(x, IGetTopic, DefaultGetTopic);
    });
  }
}

import { VoidResult } from '@benzene/abstractions';
import { IBenzeneClientContext } from '@benzene/abstractions-messages';
import { PipelineBuilderAction } from '@benzene/abstractions-middleware';

/**
 * Core-side builder for registering outbound senders — the richer counterpart of the abstractions
 * `IMessageSenderBuilder`, adding the typed-response overload.
 * Port of Benzene.Core.Messages.MessageSender.IMessageSenderBuilder.
 *
 * Overload split: C# overloads `CreateSender<TMessage>` and `CreateSender<TRequest, TResponse>` on
 * generic arity, indistinguishable once generics are erased, so per the porting convention the
 * typed-response variant is renamed `createSenderWithResponse`. C# `Void` maps to `VoidResult`.
 */
export interface IMessageSenderBuilder {
  /** Port of C# `void CreateSender<TMessage>(Action<IMiddlewarePipelineBuilder<IBenzeneClientContext<TMessage, Void>>>)`. */
  createSender<TMessage>(action: PipelineBuilderAction<IBenzeneClientContext<TMessage, VoidResult>>): void;

  /** Port of C# `void CreateSender<TRequest, TResponse>(Action<IMiddlewarePipelineBuilder<IBenzeneClientContext<TRequest, TResponse>>>)`. */
  createSenderWithResponse<TRequest, TResponse>(
    action: PipelineBuilderAction<IBenzeneClientContext<TRequest, TResponse>>,
  ): void;
}

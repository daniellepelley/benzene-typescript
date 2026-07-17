import { VoidResult } from '@benzene/abstractions';
import { PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { IBenzeneClientContext } from './BenzeneClient/IBenzeneClientContext';

/**
 * Abstraction-side builder for registering an outbound message sender over a client pipeline.
 * Port of Benzene.Abstractions.Messages.IMessageSenderBuilder (the abstractions project's copy,
 * which declares only the no-response `CreateSender<T>`; the richer core-messages
 * `IMessageSenderBuilder` adds the typed-response overload).
 *
 * C# `Void` maps to `VoidResult`.
 */
export interface IMessageSenderBuilder {
  /** Port of C# `void CreateSender<T>(Action<IMiddlewarePipelineBuilder<IBenzeneClientContext<T, Void>>> action)`. */
  createSender<T>(action: PipelineBuilderAction<IBenzeneClientContext<T, VoidResult>>): void;
}

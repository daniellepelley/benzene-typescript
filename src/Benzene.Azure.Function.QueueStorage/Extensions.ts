/** Port of Benzene.Azure.Function.QueueStorage.Extensions. */
import { IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { IAzureFunctionApp } from '@benzene/azure-function-core';
import { BenzeneMessageContext } from '@benzene/core-messages';
import { addBenzeneMessage } from '@benzene/core-message-handlers';
import { BenzeneMessageQueueStorageHandler } from './BenzeneMessageQueueStorageHandler';
import { QueueStorageContext } from './QueueStorageContext';
import { QueueStorageMessage } from './QueueStorageMessage';

/**
 * Adds direct Benzene message handling to a Queue Storage pipeline. Port of C#
 * `Extensions.UseBenzeneMessage`, which has two overloads (co-located here as one function with
 * TypeScript overload signatures, discriminated at runtime because a builder is an object and an action
 * is a function):
 *
 *  - configuring the inner direct-message pipeline INLINE via an `action` — this registers the
 *    `BenzeneMessage` services (`addBenzeneMessage`), builds a nested `BenzeneMessageContext` pipeline
 *    from `action`, and appends a `BenzeneMessageQueueStorageHandler` over it.
 *  - reusing an ALREADY-BUILT inner pipeline builder — this just builds it and appends the handler,
 *    without re-registering the services (faithful to C#, whose builder overload does not call
 *    `AddBenzeneMessage`).
 *
 * DEFERRED: C# calls `middlewarePipelineBuilder.SuppressResponse()` on the inline path (Queue Storage
 * has no reply channel), but the `BenzeneMessageResponseSuppression` primitive is not yet ported — the
 * same deferral the ported Event Hub `useBenzeneMessage` makes. The response is simply materialized and
 * ignored (only its `statusCode` is read, by `BenzeneMessageQueueStorageHandler`, to surface pass/fail);
 * nothing is written back to any transport, so the observable behavior is identical.
 *
 * @param app The Queue Storage pipeline builder to add message handling to.
 * @param actionOrBuilder Either an action configuring the inner direct-message pipeline, or an
 *   already-configured inner `BenzeneMessageContext` pipeline builder.
 */
export function useBenzeneMessage(
  app: IMiddlewarePipelineBuilder<QueueStorageContext>,
  action: PipelineBuilderAction<BenzeneMessageContext>,
): IMiddlewarePipelineBuilder<QueueStorageContext>;
export function useBenzeneMessage(
  app: IMiddlewarePipelineBuilder<QueueStorageContext>,
  builder: IMiddlewarePipelineBuilder<BenzeneMessageContext>,
): IMiddlewarePipelineBuilder<QueueStorageContext>;
export function useBenzeneMessage(
  app: IMiddlewarePipelineBuilder<QueueStorageContext>,
  actionOrBuilder:
    | PipelineBuilderAction<BenzeneMessageContext>
    | IMiddlewarePipelineBuilder<BenzeneMessageContext>,
): IMiddlewarePipelineBuilder<QueueStorageContext> {
  if (typeof actionOrBuilder === 'function') {
    app.register((x) => addBenzeneMessage(x));
    const middlewarePipelineBuilder = app.create<BenzeneMessageContext>();
    actionOrBuilder(middlewarePipelineBuilder);
    const pipeline = middlewarePipelineBuilder.build();
    return app.use((resolver) => new BenzeneMessageQueueStorageHandler(pipeline, resolver));
  }

  const pipeline = actionOrBuilder.build();
  return app.use((resolver) => new BenzeneMessageQueueStorageHandler(pipeline, resolver));
}

/**
 * Dispatches Queue Storage messages to the Azure Function app's Queue Storage entry point application.
 * Port of C# `Extensions.HandleQueueMessages(this IAzureFunctionApp, params QueueStorageMessage[])`. The
 * trigger delivers one message per invocation; the rest-parameter shape (C# `params`) exists for tests
 * and callers with several in hand.
 *
 * @param source The built Azure Function app to dispatch to.
 * @param messages The Queue Storage messages to handle.
 */
export function handleQueueMessages(
  source: IAzureFunctionApp,
  ...messages: QueueStorageMessage[]
): Promise<void> {
  return source.handleAsync(messages);
}

/**
 * Dispatches a single Queue Storage message, bound as its message text — the common `storageQueue`
 * string binding — to the Azure Function app's Queue Storage entry point application. Port of C#
 * `Extensions.HandleQueueMessage(this IAzureFunctionApp, string messageText)`.
 *
 * @param source The built Azure Function app to dispatch to.
 * @param messageText The queue message's text.
 */
export function handleQueueMessage(source: IAzureFunctionApp, messageText: string): Promise<void> {
  return handleQueueMessages(source, new QueueStorageMessage(messageText));
}

import { QueueClient } from '@azure/storage-queue';
import { IMiddlewarePipelineBuilder } from '@benzenejs/abstractions-middleware';
import { OutboundContext } from '@benzenejs/clients';
import { OutboundQueueStorageContextConverter } from './OutboundQueueStorageContextConverter';
import { QueueStorageClientMiddleware } from './QueueStorageClientMiddleware';
import { QueueStorageSendMessageContext } from './QueueStorageSendMessageContext';

/**
 * Port of Benzene.Clients.Azure.QueueStorage.Extensions (C# fluent extension methods -> free functions
 * taking the builder first).
 *
 * PORT SCOPE: like the `@benzenejs/clients-*` siblings, this ports the `OutboundContext` send path; the
 * generic `IBenzeneClientContext<T,Void>` overloads, the standalone `QueueStorageBenzeneMessageClient`,
 * and the queue reachability health-check auto-wiring are deferred (no Azure Queue Storage health-check
 * package is ported yet — see the README structure table).
 */

/** Appends the terminal `QueueStorageClientMiddleware` (built from `queueClient`) to a send pipeline. */
export function useQueueStorageClient(
  app: IMiddlewarePipelineBuilder<QueueStorageSendMessageContext>,
  queueClient: QueueClient,
): IMiddlewarePipelineBuilder<QueueStorageSendMessageContext> {
  return app.use(() => new QueueStorageClientMiddleware(queueClient));
}

/**
 * Converts an outbound route pipeline (`OutboundRoutingBuilder.route`) to send via Queue Storage: the
 * routed message, topic, and headers are packed into a `BenzeneMessageRequest` envelope serialized as
 * the queue message text, and sent through the given queue client.
 */
export function useQueueStorage(
  app: IMiddlewarePipelineBuilder<OutboundContext>,
  queueClient: QueueClient,
): IMiddlewarePipelineBuilder<OutboundContext> {
  return app.convert(new OutboundQueueStorageContextConverter(), (builder) =>
    useQueueStorageClient(builder, queueClient),
  );
}

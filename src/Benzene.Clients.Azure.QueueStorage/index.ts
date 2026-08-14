/**
 * Port of Benzene.Clients.Azure.QueueStorage — the outbound (egress) Azure Queue Storage message client.
 *
 * `useQueueStorage(outboundRoutePipeline, queueClient)` converts an `OutboundContext` route to send via a
 * caller-supplied `@azure/storage-queue` `QueueClient`. Queue Storage has no per-message properties, so
 * the routed message, topic, and headers are packed into a `BenzeneMessageRequest` envelope serialized as
 * the queue message text (the same envelope the Benzene queue-storage ingress rehydrates).
 *
 * PORT SCOPE (matching the `@benzenejs/clients-*` siblings): the `OutboundContext` send path only; the
 * generic `IBenzeneClientContext<T,Void>` converter, standalone `QueueStorageBenzeneMessageClient`, and
 * the queue-reachability health-check auto-wiring are deferred.
 */
export * from './QueueStorageSendMessageContext';
export * from './QueueStorageClientMiddleware';
export * from './OutboundQueueStorageContextConverter';
export * from './Extensions';

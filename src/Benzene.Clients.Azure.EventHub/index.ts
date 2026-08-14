/**
 * Port of Benzene.Clients.Azure.EventHub — the outbound (egress) Azure Event Hubs message client.
 *
 * `useEventHub(outboundRoutePipeline, producer, topicPropertyKey?, partitionKeyHeader?)` converts an
 * `OutboundContext` route to send via a caller-supplied `@azure/event-hubs` `EventHubProducerClient`:
 * the routed message is JSON-serialized as the event body, the topic + headers are written as event
 * `properties`, and an optional header supplies the partition key. The egress counterpart of the
 * `@benzenejs/azure-event-hub` / `@benzenejs/azure-function-event-hub` consumer packages.
 *
 * PORT SCOPE (matching the `@benzenejs/clients-*` siblings): the `OutboundContext` send path only; the
 * generic `IBenzeneClientContext<T,Void>` converter and the standalone `EventHubBenzeneMessageClient` are
 * deferred; the native `EventHubBatchMessageClient` IS now ported.
 */
export * from './EventHubSendMessageContext';
export * from './EventHubClientMiddleware';
export * from './OutboundEventHubContextConverter';
export * from './EventHubBatchMessageClient';
export * from './Extensions';

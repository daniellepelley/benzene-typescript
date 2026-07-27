/**
 * Port of Benzene.Clients.Azure.ServiceBus — the outbound (egress) Azure Service Bus message client.
 *
 * `useServiceBus(outboundRoutePipeline, sender, topicPropertyKey?)` converts an `OutboundContext` route
 * to send via a caller-supplied `@azure/service-bus` `ServiceBusSender`: the routed message is JSON-
 * serialized as the body, and the topic + headers are written as `applicationProperties` (the same
 * properties the Service Bus ingress — `@benzene/azure-service-bus` / `@benzene/azure-function-service-bus`
 * — reads to route and rehydrate headers). The egress counterpart of those consumer packages.
 *
 * PORT SCOPE (matching the `@benzene/clients-aws-*` siblings): the `OutboundContext` send path only; the
 * generic `IBenzeneClientContext<T,Void>` converter, standalone `ServiceBusBenzeneMessageClient`, and
 * native `ServiceBusBatchMessageClient` are deferred.
 */
export * from './ServiceBusSendMessageContext';
export * from './ServiceBusClientMiddleware';
export * from './OutboundServiceBusContextConverter';
export * from './Extensions';

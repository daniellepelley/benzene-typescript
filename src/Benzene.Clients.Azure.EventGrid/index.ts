/**
 * Port of Benzene.Clients.Azure.EventGrid — the outbound (egress) Azure Event Grid message client.
 *
 * `useEventGrid(outboundRoutePipeline, publisher, source)` (CloudEvents 1.0, preferred) and
 * `useEventGridEventSchema(outboundRoutePipeline, publisher)` (classic schema) convert an `OutboundContext`
 * route to send via a caller-supplied `@azure/eventgrid` `EventGridPublisherClient`. The topic becomes the
 * CloudEvent `type` (or the classic event `subject`/`eventType`), the routed message its `data`.
 *
 * PORT SCOPE (matching the `@benzenejs/clients-*` siblings): the `OutboundContext` send path only; the
 * generic `IBenzeneClientContext<T,Void>` converters and the standalone `EventGridBenzeneMessageClient` are
 * deferred; the native `EventGridBatchMessageClient` IS now ported.
 */
export * from './EventGridSendMessageContext';
export * from './EventGridClientMiddleware';
export * from './OutboundEventGridContextConverter';
export * from './OutboundEventGridEventSchemaContextConverter';
export * from './EventGridBatchMessageClient';
export * from './Extensions';

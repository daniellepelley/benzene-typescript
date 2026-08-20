import { EventHubProducerClient } from '@azure/event-hubs';
import { IMiddlewarePipelineBuilder } from '@benzenejs/abstractions-middleware';
import { OutboundContext } from '@benzenejs/clients';
import { EventHubClientMiddleware } from './EventHubClientMiddleware';
import { EventHubSendMessageContext } from './EventHubSendMessageContext';
import { OutboundEventHubContextConverter } from './OutboundEventHubContextConverter';

/**
 * Port of Benzene.Clients.Azure.EventHub.Extensions (C# fluent extension methods -> free functions
 * taking the builder first).
 *
 * PORT SCOPE: like the `@benzenejs/clients-aws-*` / `@benzenejs/clients-azure-service-bus` siblings, this
 * ports the `OutboundContext` send path; the generic `IBenzeneClientContext<T,Void>` overloads and the
 * standalone `EventHubBenzeneMessageClient` are deferred (see the README structure table), while the
 * native `EventHubBatchMessageClient` IS ported. The C# `.UseEventHub(action, …)` custom-middleware overload is also
 * omitted (TypeScript can't overload a free function on `producer`-vs-`action`).
 */

/** Appends the terminal `EventHubClientMiddleware` (built from `producerClient`) to a send pipeline. */
export function useEventHubClient(
  app: IMiddlewarePipelineBuilder<EventHubSendMessageContext>,
  producerClient: EventHubProducerClient,
): IMiddlewarePipelineBuilder<EventHubSendMessageContext> {
  return app.use(() => new EventHubClientMiddleware(producerClient));
}

/**
 * Converts an outbound route pipeline (`OutboundRoutingBuilder.route`) to send via Event Hubs: the
 * routed message becomes the event body, the topic + per-call headers become event `properties`, and an
 * optional `partitionKeyHeader` selects the header whose value becomes the partition key.
 */
export function useEventHub(
  app: IMiddlewarePipelineBuilder<OutboundContext>,
  producerClient: EventHubProducerClient,
  topicPropertyKey: string = OutboundEventHubContextConverter.DefaultTopicProperty,
  partitionKeyHeader?: string,
): IMiddlewarePipelineBuilder<OutboundContext> {
  return app.convert(
    new OutboundEventHubContextConverter(topicPropertyKey, partitionKeyHeader),
    (builder) => useEventHubClient(builder, producerClient),
  );
}

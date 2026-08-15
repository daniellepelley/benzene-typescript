/**
 * A small, example-local outbound Event Hub converter that pairs correctly with the only Event Hub
 * ingress this port has (`@benzenejs/azure-function-event-hub`'s envelope-based `useBenzeneMessage`).
 *
 * WHY THIS EXISTS (a framework nuance worth documenting, not a framework bug): `@benzenejs/clients-azure-
 * event-hub`'s own `useEventHub(...)` writes the topic as an event *property* and the raw serialized
 * message as the event body — the same convention Service Bus uses, and a genuinely valid Event Hub
 * pattern. But this port's Event Hub *ingress* (`BenzeneMessageEventHubHandler`, wired by
 * `useBenzeneMessage`) only understands one shape: the event body itself must deserialize into a
 * `{ topic, headers, body }` envelope — there is no "property-based" ingress counterpart (unlike Service
 * Bus, whose `ServiceBusMessageTopicGetter` reads the `topic` property the outbound converter writes).
 * .NET hit the exact same seam in its own AzureFunctionsMesh example and closed it with a small
 * *framework* addition — property-based Event Hub ingress (see that example's README, "Interconnectivity"
 * section, and `Benzene.Azure.Function.EventHub`). That framework addition has not been ported to
 * TypeScript yet.
 *
 * Rather than improvise a framework change here, this file solves it entirely at the example level by
 * pairing the *existing* egress building blocks (`IContextConverter`, `useEventHubClient`,
 * `EventHubSendMessageContext`) with an envelope-shaped body — the exact convention
 * `@benzenejs/clients-azure-queue-storage`'s `OutboundQueueStorageContextConverter` already uses for ITS
 * envelope-only ingress. `order:placed` is wired with this converter instead of the package's top-level
 * `useEventHub` convenience function; every other transport in this example (Service Bus, Event Grid)
 * uses its package's convenience function unmodified, because their ingress/egress pairs already agree on
 * the wire shape. See the example README's "Framework gap-check" section.
 */
import { EventData, EventHubProducerClient } from '@azure/event-hubs';
import { ISerializer, VoidResult } from '@benzenejs/abstractions';
import { IContextConverter, IMiddlewarePipelineBuilder } from '@benzenejs/abstractions-middleware';
import { OutboundContext } from '@benzenejs/clients';
import { JsonSerializer } from '@benzenejs/core-message-handlers';
import { BenzeneMessageRequest } from '@benzenejs/core-messages';
import { BenzeneResult } from '@benzenejs/results';
import { EventHubSendMessageContext, useEventHubClient } from '@benzenejs/clients-azure-event-hub';

class EnvelopeEventHubContextConverter
  implements IContextConverter<OutboundContext, EventHubSendMessageContext>
{
  private readonly serializer: ISerializer = new JsonSerializer();

  createRequestAsync(contextIn: OutboundContext): Promise<EventHubSendMessageContext> {
    const envelope = new BenzeneMessageRequest();
    envelope.topic = contextIn.topic;
    envelope.headers = contextIn.headers;
    envelope.body = this.serializer.serialize(contextIn.request);

    const eventData: EventData = { body: this.serializer.serialize(envelope) };
    return Promise.resolve(new EventHubSendMessageContext(eventData));
  }

  mapResponseAsync(contextIn: OutboundContext, _contextOut: EventHubSendMessageContext): Promise<void> {
    contextIn.response = BenzeneResult.accepted<VoidResult>(new VoidResult());
    return Promise.resolve();
  }
}

/**
 * Routes an outbound topic to Event Hubs with an envelope-shaped body, so the matching
 * `useBenzeneMessage`-wired Event Hub ingress can rehydrate it. Drop-in replacement for
 * `@benzenejs/clients-azure-event-hub`'s `useEventHub(app, producerClient)` wherever the consumer routes
 * via `useBenzeneMessage` (as every consumer in this example does).
 */
export function useEnvelopeEventHub(
  app: IMiddlewarePipelineBuilder<OutboundContext>,
  producerClient: EventHubProducerClient,
): IMiddlewarePipelineBuilder<OutboundContext> {
  return app.convert(new EnvelopeEventHubContextConverter(), (builder) =>
    useEventHubClient(builder, producerClient),
  );
}

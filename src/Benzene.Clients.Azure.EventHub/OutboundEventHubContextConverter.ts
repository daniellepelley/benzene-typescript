/** Port of Benzene.Clients.Azure.EventHub.OutboundEventHubContextConverter. */
import { EventData } from '@azure/event-hubs';
import { ISerializer, VoidResult } from '@benzenejs/abstractions';
import { IContextConverter } from '@benzenejs/abstractions-middleware';
import { OutboundContext } from '@benzenejs/clients';
import { JsonSerializer } from '@benzenejs/core-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import { EventHubSendMessageContext } from './EventHubSendMessageContext';

/**
 * Converts an outbound `OutboundContext` (an `OutboundRoutingBuilder.route` pipeline) into an
 * `EventHubSendMessageContext`, so a topic routed here is sent via Azure Event Hubs. The
 * `OutboundContext` counterpart of the (deferred) generic `EventHubContextConverter<T>`.
 *
 * Event Hubs has no request/response semantics beyond a send acknowledgement, so the mapped response is
 * always an accepted `VoidResult`-typed `IBenzeneResult` — a topic routed here must be sent via
 * `IBenzeneMessageSender.sendAsync<TRequest, VoidResult>`. The serialized message becomes the event
 * body; the topic + per-call headers become event `properties`. An optional `partitionKeyHeader` picks
 * the header whose value becomes the Event Hubs partition key (co-locating related events on one
 * partition, preserving order).
 */
export class OutboundEventHubContextConverter
  implements IContextConverter<OutboundContext, EventHubSendMessageContext>
{
  /**
   * The default event-property key the topic is written to. A single default, not a hard-coded value —
   * pass a different key to interoperate with a consumer that routes on another property; keep it in
   * sync with the consumer's property key.
   */
  static readonly DefaultTopicProperty = 'topic';

  private readonly serializer: ISerializer;

  constructor(
    private readonly topicPropertyKey: string = OutboundEventHubContextConverter.DefaultTopicProperty,
    private readonly partitionKeyHeader?: string,
    serializer?: ISerializer,
  ) {
    this.serializer = serializer ?? new JsonSerializer();
  }

  createRequestAsync(contextIn: OutboundContext): Promise<EventHubSendMessageContext> {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(contextIn.headers)) {
      properties[key] = value;
    }
    properties[this.topicPropertyKey] = contextIn.topic;

    const eventData: EventData = {
      body: this.serializer.serialize(contextIn.request),
      properties,
    };

    const partitionKey =
      this.partitionKeyHeader !== undefined ? contextIn.headers[this.partitionKeyHeader] : undefined;

    const contextOut = new EventHubSendMessageContext(eventData, partitionKey);
    contextOut.signal = contextIn.signal;
    return Promise.resolve(contextOut);
  }

  mapResponseAsync(contextIn: OutboundContext, _contextOut: EventHubSendMessageContext): Promise<void> {
    contextIn.response = BenzeneResult.accepted<VoidResult>(new VoidResult());
    return Promise.resolve();
  }
}

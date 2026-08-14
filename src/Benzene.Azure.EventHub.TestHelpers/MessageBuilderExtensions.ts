/** Port of Benzene.Azure.EventHub.TestHelpers.MessageBuilderExtensions. */
import type { ReceivedEventData } from '@azure/event-hubs';
import { IMessageBuilder } from '@benzenejs/abstractions';
import { EventHubConsumerMessageTopicGetter } from '@benzenejs/azure-event-hub';
import { MessageSerializer } from '@benzenejs/testing';
import { jsonMessageSerializer } from './defaults';

/**
 * Turns a platform-neutral `@benzenejs/testing` `messageBuilder(...)` into a `ReceivedEventData` for the
 * self-hosted Event Hub consumer, so a component test can push the demo message through an
 * {@link EventHubWorkerBenzeneTestHost} exactly as the hub would deliver it. The consumer routes by the
 * `"topic"` event property (unlike the Azure Functions Event Hub trigger's envelope body), so the topic
 * rides as a property (the key from `EventHubConsumerMessageTopicGetter.DefaultTopicProperty`), every
 * header as a further property, and the serialized message as the body.
 *
 * MESSAGE-TYPE ADAPTATION: C# builds an `Azure.Messaging.EventHubs.EventData` (the send side). The TS
 * consumer's `EventHubConsumerApplication.handleAsync` — like `@benzenejs/azure-function-event-hub` — reads
 * a *received* event, so the port builds the read-side `ReceivedEventData` from `@azure/event-hubs`
 * directly (an interface with several service-populated fields, given placeholder values here and cast).
 * The body is the serialized string rather than a `BinaryData`; `EventHubConsumerMessageBodyGetter` reads
 * a string body verbatim, so the wire-visible value is identical.
 *
 * IDIOM MAP: the two C# overloads collapse to one free function with an optional trailing `serializer`,
 * defaulting to JSON.
 *
 * @param source The message builder.
 * @param serializer The serializer used to render the event body (defaults to JSON).
 * @returns The Event Hub event.
 */
export function asEventHubBenzeneMessage<T>(
  source: IMessageBuilder<T>,
  serializer: MessageSerializer = jsonMessageSerializer,
): ReceivedEventData {
  const properties: Record<string, unknown> = {
    [EventHubConsumerMessageTopicGetter.DefaultTopicProperty]: source.topic,
  };
  for (const [key, value] of Object.entries(source.headers)) {
    properties[key] = value;
  }

  return {
    body: serializer.serialize(source.message),
    properties,
    enqueuedTimeUtc: new Date(0),
    partitionKey: null,
    offset: '0',
    sequenceNumber: 0,
    getRawAmqpMessage: () => {
      throw new Error('getRawAmqpMessage is not available on a test-built ReceivedEventData');
    },
  } as unknown as ReceivedEventData;
}

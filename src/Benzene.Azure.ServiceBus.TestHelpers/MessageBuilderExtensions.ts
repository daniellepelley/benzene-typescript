/** Port of Benzene.Azure.ServiceBus.TestHelpers.MessageBuilderExtensions. */
import type { ServiceBusReceivedMessage } from '@azure/service-bus';
import { IMessageBuilder } from '@benzenejs/abstractions';
import { MessageSerializer } from '@benzenejs/testing';
import { jsonMessageSerializer } from './defaults';

/**
 * Turns a platform-neutral `@benzenejs/testing` `messageBuilder(...)` into a `ServiceBusReceivedMessage`,
 * so a component test can push the demo message through a {@link ServiceBusWorkerBenzeneTestHost} exactly
 * as the broker would deliver it: the topic rides as the `"topic"` application property, every header as
 * a further application property, and the serialized message as the body — the exact shape
 * `ServiceBusConsumerMessageTopicGetter` / `ServiceBusConsumerMessageHeadersGetter` /
 * `ServiceBusConsumerMessageBodyGetter` read.
 *
 * MESSAGE-TYPE ADAPTATION: C# calls `ServiceBusModelFactory.ServiceBusReceivedMessage(body, properties)`;
 * `@azure/service-bus` has no model factory (`ServiceBusReceivedMessage` is an interface), so the port
 * constructs the plain object the getters actually read and casts it. The body is the serialized string
 * rather than a `BinaryData` — `ServiceBusConsumerMessageBodyGetter` reads a string body verbatim (the
 * .NET side calls `.ToString()` on the `BinaryData`), so the wire-visible value is identical.
 *
 * IDIOM MAP: the two C# overloads (`AsAzureServiceBusMessage()` / `AsAzureServiceBusMessage(ISerializer)`)
 * collapse to one free function with an optional trailing `serializer`, defaulting to JSON — matching the
 * `MessageSerializer` shape reused across the `@benzenejs/*-test-helpers` builders.
 *
 * @param source The message builder.
 * @param serializer The serializer used to render the message body (defaults to JSON).
 * @returns The Service Bus message.
 */
export function asAzureServiceBusMessage<T>(
  source: IMessageBuilder<T>,
  serializer: MessageSerializer = jsonMessageSerializer,
): ServiceBusReceivedMessage {
  const applicationProperties: Record<string, unknown> = { topic: source.topic };
  for (const [key, value] of Object.entries(source.headers)) {
    applicationProperties[key] = value;
  }

  return {
    body: serializer.serialize(source.message),
    applicationProperties,
  } as unknown as ServiceBusReceivedMessage;
}

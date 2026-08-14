/** Port of Benzene.Azure.Function.ServiceBus.TestHelpers.MessageBuilderExtensions. */
import type { ServiceBusReceivedMessage } from '@azure/service-bus';
import { IMessageBuilder } from '@benzenejs/abstractions';
import { MessageSerializer } from '@benzenejs/testing';
import { jsonMessageSerializer } from './defaults';

export interface AsAzureServiceBusMessageOptions {
  serializer?: MessageSerializer;
}

/**
 * Builds a `ServiceBusReceivedMessage` from a message builder: the topic (plus every header) rides on the
 * message's `applicationProperties`, and the serialized message is the body - the shape the Service Bus
 * adapter routes on. Port of `AsAzureServiceBusMessage`.
 *
 * `ServiceBusReceivedMessage` has many broker-populated, read-only fields a test never sets; like the
 * ported pipeline tests we build the handful the adapter reads and cast through `unknown`.
 */
export function asAzureServiceBusMessage<T>(
  source: IMessageBuilder<T>,
  options: AsAzureServiceBusMessageOptions = {},
): ServiceBusReceivedMessage {
  const { serializer = jsonMessageSerializer } = options;

  return {
    messageId: 'message-1',
    body: serializer.serialize(source.message),
    applicationProperties: { ...source.headers, topic: source.topic },
  } as unknown as ServiceBusReceivedMessage;
}

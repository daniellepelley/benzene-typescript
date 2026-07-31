/** Port of Benzene.RabbitMq.TestHelpers.MessageBuilderExtensions. */
import type { ConsumeMessage } from 'amqplib';
import { IMessageBuilder } from '@benzene/abstractions';
import { RabbitMqConstants } from '@benzene/rabbitmq';
import { MessageSerializer } from '@benzene/testing';
import { jsonMessageSerializer } from './defaults';

/**
 * Turns a platform-neutral `@benzene/testing` `messageBuilder(...)` into a `ConsumeMessage`, so a
 * component test can push the demo message through a {@link RabbitMqBenzeneTestHost} exactly as the
 * broker would deliver it: the topic rides as the `"topic"` header (and as the AMQP routing key), every
 * header as a further delivery header, and the serialized message as the `content` body — the exact shape
 * `RabbitMqMessageTopicGetter` / `RabbitMqMessageHeadersGetter` / `RabbitMqMessageBodyGetter` read.
 *
 * MESSAGE-TYPE ADAPTATION: C# calls `new BasicDeliverEventArgs(...)` with header values UTF-8-encoded to
 * `byte[]` (the shape `RabbitMQ.Client` delivers on the wire). amqplib exposes `ConsumeMessage` with
 * `properties.headers` already decoded — string-valued headers arrive as plain `string`s — and the
 * ported getters read a `string` verbatim (decoding a `Buffer` only when present). So this builds the
 * decoded object the getters actually read and casts it (the `ConsumeMessage` fields the pipeline never
 * touches, e.g. `deliveryTag`, are filled with representative test values). The body is the serialized
 * string rendered to a UTF-8 `Buffer` — the exact `content` `RabbitMqMessageBodyGetter` decodes.
 *
 * IDIOM MAP: the two C# overloads (`AsRabbitMqBenzeneMessage()` / `AsRabbitMqBenzeneMessage(ISerializer)`)
 * collapse to one free function with an optional trailing `serializer`, defaulting to JSON — matching the
 * `MessageSerializer` shape reused across the `@benzene/*-test-helpers` builders.
 *
 * @param source The message builder.
 * @param serializer The serializer used to render the delivery body (defaults to JSON).
 * @returns The RabbitMQ delivery.
 */
export function asRabbitMqBenzeneMessage<T>(
  source: IMessageBuilder<T>,
  serializer: MessageSerializer = jsonMessageSerializer,
): ConsumeMessage {
  const headers: Record<string, string> = { [RabbitMqConstants.DefaultTopicHeader]: source.topic };
  for (const [key, value] of Object.entries(source.headers)) {
    headers[key] = value;
  }

  return {
    content: Buffer.from(serializer.serialize(source.message), 'utf8'),
    fields: {
      consumerTag: 'test-consumer',
      deliveryTag: 1,
      redelivered: false,
      exchange: '',
      routingKey: source.topic,
    },
    properties: { headers } as unknown as ConsumeMessage['properties'],
  } as ConsumeMessage;
}

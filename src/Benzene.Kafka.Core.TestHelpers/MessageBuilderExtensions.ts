/** Port of Benzene.Kafka.Core.TestHelpers.MessageBuilderExtensions. */
import type { EachMessagePayload, IHeaders } from 'kafkajs';
import { IMessageBuilder } from '@benzene/abstractions';
import { MessageSerializer } from '@benzene/testing';
import { jsonMessageSerializer } from './defaults';

/**
 * Turns a platform-neutral `@benzene/testing` `messageBuilder(...)` into an `EachMessagePayload`, so a
 * component test can push the demo message through a {@link KafkaBenzeneTestHost} exactly as the broker
 * would deliver it. Kafka routes on the literal record `topic` (the builder's topic must be the Kafka
 * topic name, not a colon-separated id), every header rides as a record header, and the serialized
 * message is the raw `value` payload — the exact shape `KafkaMessageTopicGetter` /
 * `KafkaMessageHeadersGetter` / `KafkaMessageBodyGetter` read.
 *
 * MESSAGE-TYPE ADAPTATION: C# builds a `ConsumeResult<Ignore, string>` (a string-valued, keyless record).
 * kafkajs delivers an `EachMessagePayload` whose `message.value` and header values are `Buffer`s, so this
 * renders the serialized body and the header values to UTF-8 `Buffer`s (the getters decode a `Buffer`, and
 * also accept a `string`). The partition/offset/key/timestamp fields the pipeline never reads are filled
 * with representative test values, and the whole is cast to `EachMessagePayload`.
 *
 * IDIOM MAP: the two C# overloads (`AsKafkaBenzeneMessage()` / `AsKafkaBenzeneMessage(ISerializer)`)
 * collapse to one free function with an optional trailing `serializer`, defaulting to JSON — matching the
 * `MessageSerializer` shape reused across the `@benzene/*-test-helpers` builders.
 *
 * @param source The message builder.
 * @param serializer The serializer used to render the record value (defaults to JSON).
 * @returns The Kafka record payload.
 */
export function asKafkaBenzeneMessage<T>(
  source: IMessageBuilder<T>,
  serializer: MessageSerializer = jsonMessageSerializer,
): EachMessagePayload {
  const headers: IHeaders = {};
  for (const [key, value] of Object.entries(source.headers)) {
    headers[key] = Buffer.from(value, 'utf8');
  }

  return {
    topic: source.topic,
    partition: 0,
    message: {
      key: null,
      value: Buffer.from(serializer.serialize(source.message), 'utf8'),
      headers,
      timestamp: '0',
      offset: '0',
      attributes: 0,
      size: 0,
    },
    heartbeat: () => Promise.resolve(),
    pause: () => () => undefined,
  } as unknown as EachMessagePayload;
}

/** Port of Benzene.GoogleCloud.Functions.PubSub.TestHelpers.MessageBuilderExtensions. */
import { IMessageBuilder } from '@benzenejs/abstractions';
import {
  MessagePublishedData,
  PubSubMessageTopicGetter,
} from '@benzenejs/google-cloud-functions-pubsub';
import { MessageSerializer } from '@benzenejs/testing';
import { jsonMessageSerializer } from './defaults';

export interface AsPubSubEventOptions {
  serializer?: MessageSerializer;
}

/**
 * Bridges the shared `@benzenejs/testing` `messageBuilder(...)` (used identically across every transport's
 * test helpers) into a Pub/Sub-shaped {@link MessagePublishedData}: the topic rides on the `"topic"`
 * attribute (via {@link PubSubMessageTopicGetter.DefaultTopicAttribute} — the exact key
 * `PubSubMessageTopicGetter` reads), every header rides as a further attribute (what
 * `PubSubMessageHeadersGetter` returns), and the serialized message is the base64-encoded `data`
 * (`PubSubMessageBodyGetter` base64-decodes it). Port of `AsPubSubEvent`.
 *
 * MESSAGE-TYPE ADAPTATION: the C# builds `Google.Events.Protobuf`'s protobuf `PubsubMessage`, whose
 * `ByteString.CopyFromUtf8(...)` `Data` the framework renders to base64 on the CloudEvent JSON wire. The TS
 * port's {@link MessagePublishedData} IS that already-JSON CloudEvent shape (`message.data` is the base64
 * string), so this base64-encodes the serialized body explicitly to match what `PubSubMessageBodyGetter`
 * decodes — see the transport's `MessagePublishedData` MESSAGE-TYPE ADAPTATION note.
 *
 * IDIOM MAP: the single C# `AsPubSubEvent` (hard-coded `new JsonSerializer()`) takes an optional trailing
 * options object with a `serializer` (defaulting to JSON), matching the Azure/RabbitMQ `as*` builders.
 *
 * @param source The message builder to convert.
 * @param options Optional serializer override (defaults to JSON).
 * @returns A {@link MessagePublishedData} ready to dispatch via `host.sendPubSubAsync(...)`.
 */
export function asPubSubEvent<T>(
  source: IMessageBuilder<T>,
  options: AsPubSubEventOptions = {},
): MessagePublishedData {
  const { serializer = jsonMessageSerializer } = options;

  const body = serializer.serialize(source.message);

  return {
    message: {
      data: Buffer.from(body, 'utf8').toString('base64'),
      messageId: crypto.randomUUID(),
      attributes: {
        [PubSubMessageTopicGetter.DefaultTopicAttribute]: source.topic,
        ...source.headers,
      },
    },
    subscription: 'projects/test-project/subscriptions/test-subscription',
  };
}

/** Port of Benzene.Aws.Sqs.TestHelpers.MessageBuilderExtensions. */
import type { Message } from '@aws-sdk/client-sqs';
import { IMessageBuilder } from '@benzenejs/abstractions';

/**
 * Turns a platform-neutral `@benzenejs/testing` `messageBuilder(...)` into a single
 * `@aws-sdk/client-sqs` `Message`, so a component test can push the demo message through the standalone
 * SQS polling consumer (`@benzenejs/aws-sqs`) exactly as the queue would deliver it: the topic (plus every
 * header) becomes a `String` message attribute and the serialized message becomes the body.
 *
 * MESSAGE-TYPE ADAPTATION: C# builds an `Amazon.SQS.Model.Message`; the aws-sdk v3 counterpart is the
 * `Message` type from `@aws-sdk/client-sqs` (PascalCase fields `Body`, `MessageAttributes`, with
 * `StringValue`/`DataType` on each attribute) — the exact shape `SqsConsumerMessageTopicGetter` /
 * `SqsConsumerMessageHeadersGetter` / `SqsConsumerMessageBodyGetter` read. The C# `AsSqsMessage` takes
 * no serializer and serializes with `System.Text.Json`, so the port hard-codes `JSON.stringify` (no
 * serializer parameter), staying faithful to the source rather than borrowing the sibling
 * ServiceBus/EventHub builders' optional serializer.
 *
 * @param source The message builder.
 * @returns The SQS message.
 */
export function asSqsMessage<T>(source: IMessageBuilder<T>): Message {
  const attributes: Record<string, string> = { ...source.headers, topic: source.topic };

  return {
    Body: JSON.stringify(source.message),
    MessageAttributes: Object.fromEntries(
      Object.entries(attributes).map(([key, value]) => [
        key,
        { StringValue: value, DataType: 'String' },
      ]),
    ),
  };
}

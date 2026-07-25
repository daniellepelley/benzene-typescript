/** Port of Benzene.Aws.Lambda.Sqs.TestHelpers.MessageBuilderExtensions. */
import { SQSEvent, SQSRecord } from 'aws-lambda';
import { IMessageBuilder } from '@benzene/abstractions';
import { MessageSerializer } from '@benzene/testing';
import { jsonMessageSerializer } from './defaults';

export interface AsSqsOptions {
  /** How many identical records to emit (a batch), default 1. */
  numberOfMessages?: number;
  serializer?: MessageSerializer;
}

/**
 * Builds an `SQSEvent` from a message builder: the topic (plus every header) becomes a `String`
 * message attribute, the serialized message becomes the body. Port of
 * `Benzene.Aws.Lambda.Sqs.TestHelpers.MessageBuilderExtensions.AsSqs`.
 */
export function asSqs<T>(source: IMessageBuilder<T>, options: AsSqsOptions = {}): SQSEvent {
  const { numberOfMessages = 1, serializer = jsonMessageSerializer } = options;
  const attributes = { ...source.headers, topic: source.topic };
  const body = serializer.serialize(source.message);

  const records: SQSRecord[] = Array.from({ length: numberOfMessages }, (_unused, index) => ({
    messageId: `message-${index + 1}`,
    receiptHandle: `receipt-${index + 1}`,
    body,
    attributes: {
      ApproximateReceiveCount: '1',
      SentTimestamp: '0',
      SenderId: 'sender',
      ApproximateFirstReceiveTimestamp: '0',
    },
    messageAttributes: Object.fromEntries(
      Object.entries(attributes).map(([key, value]) => [
        key,
        { stringValue: value, dataType: 'String' },
      ]),
    ),
    md5OfBody: '',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:eu-west-1:123456789012:queue',
    awsRegion: 'eu-west-1',
  }));

  return { Records: records };
}

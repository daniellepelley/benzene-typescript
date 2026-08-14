/** Port of Benzene.Aws.Lambda.Kafka.TestHelpers.MessageBuilderExtensions. */
import { MSKEvent, MSKRecord } from 'aws-lambda';
import { IMessageBuilder } from '@benzenejs/abstractions';
import { MessageSerializer } from '@benzenejs/testing';
import { jsonMessageSerializer } from './defaults';

export interface AsAwsKafkaEventOptions {
  serializer?: MessageSerializer;
}

/**
 * Builds an AWS MSK (`aws:kafka`) event from a message builder: the topic becomes the record topic, the
 * serialized message becomes the base64 `value`, and each header becomes a Kafka record header (its value
 * UTF-8 bytes). Port of `Benzene.Aws.Lambda.Kafka.TestHelpers.MessageBuilderExtensions.AsAwsKafkaEvent`.
 */
export function asAwsKafkaEvent<T>(
  source: IMessageBuilder<T>,
  options: AsAwsKafkaEventOptions = {},
): MSKEvent {
  const { serializer = jsonMessageSerializer } = options;
  const record: MSKRecord = {
    topic: source.topic,
    partition: 0,
    offset: 0,
    timestamp: 0,
    timestampType: 'CREATE_TIME',
    key: Buffer.from('key').toString('base64'),
    value: Buffer.from(serializer.serialize(source.message), 'utf8').toString('base64'),
    headers: [
      Object.fromEntries(
        Object.entries(source.headers).map(([key, value]) => [key, [...Buffer.from(value, 'utf8')]]),
      ),
    ],
  };

  return {
    eventSource: 'aws:kafka',
    eventSourceArn: 'arn:aws:kafka:eu-west-1:123456789012:cluster/demo/uuid',
    bootstrapServers: 'b-1.demo.kafka.eu-west-1.amazonaws.com:9092',
    records: { [`${source.topic}-0`]: [record] },
  };
}

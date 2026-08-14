/** Kinesis test-event builder (no C# TestHelper counterpart; based on the ported KinesisPipelineTest shape). */
import { KinesisStreamEvent, KinesisStreamRecord } from 'aws-lambda';
import { IMessageBuilder } from '@benzenejs/abstractions';
import { MessageSerializer } from '@benzenejs/testing';
import { jsonMessageSerializer } from './defaults';

export interface AsKinesisOptions {
  /** How many identical records to emit, default 1. */
  numberOfRecords?: number;
  serializer?: MessageSerializer;
}

/**
 * Builds a `KinesisStreamEvent` from a message builder: the serialized message becomes the base64
 * `kinesis.data`. A Kinesis record carries no topic, so the pipeline routes via `usePresetTopic`; the
 * builder's topic is therefore unused (kept only for a consistent call shape).
 */
export function asKinesis<T>(source: IMessageBuilder<T>, options: AsKinesisOptions = {}): KinesisStreamEvent {
  const { numberOfRecords = 1, serializer = jsonMessageSerializer } = options;
  const data = Buffer.from(serializer.serialize(source.message), 'utf8').toString('base64');

  const records: KinesisStreamRecord[] = Array.from({ length: numberOfRecords }, (_unused, index) => ({
    awsRegion: 'eu-west-1',
    eventID: `shardId-000000000000:${index + 1}`,
    eventName: 'aws:kinesis:record',
    eventSource: 'aws:kinesis',
    eventSourceARN: 'arn:aws:kinesis:eu-west-1:123456789012:stream/orders',
    eventVersion: '1.0',
    invokeIdentityArn: 'arn:aws:iam::123456789012:role/lambda',
    kinesis: {
      approximateArrivalTimestamp: 0,
      data,
      kinesisSchemaVersion: '1.0',
      partitionKey: `partition-${index + 1}`,
      sequenceNumber: String(index + 1),
    },
  }));

  return { Records: records };
}

/** Port of Benzene.Aws.Lambda.DynamoDb.TestHelpers.MessageBuilderExtensions. */
import { AttributeValue, DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda';
import { IMessageBuilder } from '@benzenejs/abstractions';

export interface AsDynamoDbOptions {
  /** How many identical stream records to emit, default 1. */
  numberOfRecords?: number;
}

/**
 * Builds a `DynamoDBStreamEvent` from a message builder: the topic is parsed as `"{table}:{eventName}"`
 * (a bare table name defaults to `INSERT`) - matching the `"{table}:{eventName}"` topics the adapter
 * routes on - and the message is marshalled into DynamoDB AttributeValue format and placed in `NewImage`
 * (or `OldImage` for `REMOVE`). Port of `AsDynamoDb`.
 *
 * The AttributeValue marshaller is the inverse of the adapter's `DynamoDbAttributeValueConverter`
 * (S/N/BOOL/NULL/M/L), so a plain `{ orderId: '42' }` becomes `{ orderId: { S: '42' } }` and unmarshals
 * back to `{ orderId: '42' }` in the handler.
 */
export function asDynamoDb<T>(
  source: IMessageBuilder<T>,
  options: AsDynamoDbOptions = {},
): DynamoDBStreamEvent {
  const { numberOfRecords = 1 } = options;

  const [table, eventNamePart] = (source.topic || 'benzene-test').split(':');
  const eventName = (eventNamePart ?? 'INSERT') as 'INSERT' | 'MODIFY' | 'REMOVE';
  const image = marshalMap((source.message ?? {}) as Record<string, unknown>);

  const records: DynamoDBRecord[] = Array.from({ length: numberOfRecords }, (_unused, index) => ({
    eventID: `event-${index + 1}`,
    eventName,
    eventVersion: '1.1',
    eventSource: 'aws:dynamodb',
    eventSourceARN: `arn:aws:dynamodb:eu-west-1:123456789012:table/${table}/stream/2026-01-01T00:00:00.000`,
    awsRegion: 'eu-west-1',
    dynamodb: {
      SequenceNumber: String(index + 1),
      StreamViewType: 'NEW_AND_OLD_IMAGES',
      SizeBytes: 1,
      NewImage: eventName === 'REMOVE' ? undefined : image,
      OldImage: eventName === 'REMOVE' ? image : undefined,
    },
  }));

  return { Records: records };
}

function marshalMap(source: Record<string, unknown>): Record<string, AttributeValue> {
  const map: Record<string, AttributeValue> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      map[key] = marshalValue(value);
    }
  }
  return map;
}

function marshalValue(value: unknown): AttributeValue {
  if (value === null) {
    return { NULL: true } as AttributeValue;
  }
  if (typeof value === 'string') {
    return { S: value } as AttributeValue;
  }
  if (typeof value === 'number') {
    return { N: String(value) } as AttributeValue;
  }
  if (typeof value === 'boolean') {
    return { BOOL: value } as AttributeValue;
  }
  if (Array.isArray(value)) {
    return { L: value.map(marshalValue) } as AttributeValue;
  }
  if (typeof value === 'object') {
    return { M: marshalMap(value as Record<string, unknown>) } as AttributeValue;
  }
  return { S: String(value) } as AttributeValue;
}

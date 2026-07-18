/** Port of Benzene.Aws.Lambda.DynamoDb.DynamoDbRecordContext. */
import { DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda';

/**
 * The middleware pipeline context for a single record within a DynamoDB Streams batch.
 *
 * TYPE-MODEL ADAPTATION: the C# package models its own `DynamoDbEvent`/`DynamoDbStreamRecord`/
 * `DynamoDbStreamData` to stay free of `Amazon.Lambda.DynamoDBEvents`. This port instead depends on the
 * ecosystem-native `@types/aws-lambda` `DynamoDBStreamEvent`/`DynamoDBRecord`/`StreamRecord` (the same
 * choice the ported SQS adapter made in using `SQSEvent`/`SQSRecord`), so `DynamoDbEvent.cs`,
 * `DynamoDbStreamRecord.cs`, `DynamoDbStreamData.cs` and `DynamoDbBatchResponse.cs` are NOT ported — the
 * `@types/aws-lambda` `DynamoDBBatchResponse` replaces the last. Field mapping: the record envelope is
 * camelCase (`record.eventName`, `record.eventID`, `record.eventSourceARN`, `record.awsRegion`,
 * `record.dynamodb`) while the nested `dynamodb` object is PascalCase (`Keys`, `NewImage`, `OldImage`,
 * `SequenceNumber`, `StreamViewType`).
 */
export class DynamoDbRecordContext {
  private constructor(dynamoDbEvent: DynamoDBStreamEvent, record: DynamoDBRecord) {
    this.dynamoDbEvent = dynamoDbEvent;
    this.record = record;
  }

  /** Creates a context for a single record within a stream batch. Port of C# `CreateInstance`. */
  static createInstance(
    dynamoDbEvent: DynamoDBStreamEvent,
    record: DynamoDBRecord,
  ): DynamoDbRecordContext {
    return new DynamoDbRecordContext(dynamoDbEvent, record);
  }

  /** The full stream batch event this record belongs to. */
  readonly dynamoDbEvent: DynamoDBStreamEvent;

  /** The specific stream record this context represents. */
  readonly record: DynamoDBRecord;

  /**
   * Whether this record was handled successfully. Set by `DynamoDbMessageMessageHandlerResultSetter`;
   * `undefined` if no result has been set yet (C# `bool?` maps to `boolean | undefined`).
   */
  isSuccessful?: boolean;
}

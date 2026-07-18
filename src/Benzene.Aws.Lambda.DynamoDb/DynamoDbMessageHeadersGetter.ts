/** Port of Benzene.Aws.Lambda.DynamoDb.DynamoDbMessageHeadersGetter. */
import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { DynamoDbRecordContext } from './DynamoDbRecordContext';
import { DynamoDbUtils } from './DynamoDbUtils';

/**
 * Exposes the stream record's envelope metadata as `dynamodb-`-prefixed headers (plan decision DS4).
 * Unlike EventBridge there is no embedded Benzene wire-header convention here — these events originate
 * from table writes, not from a Benzene publisher. PascalCase mapping: the record envelope is camelCase
 * (`record.eventName`, `record.eventID`, `record.eventSourceARN`, `record.awsRegion`) and the nested
 * `dynamodb` object PascalCase (`SequenceNumber`, `StreamViewType`).
 */
export class DynamoDbMessageHeadersGetter implements IMessageHeadersGetter<DynamoDbRecordContext> {
  getHeaders(context: DynamoDbRecordContext): Record<string, string> {
    const record = context.record;
    const headers: Record<string, string> = {};

    addIfPresent(headers, 'dynamodb-event-name', record.eventName);
    addIfPresent(headers, 'dynamodb-event-id', record.eventID);
    addIfPresent(headers, 'dynamodb-table', DynamoDbUtils.getTableName(record.eventSourceARN));
    addIfPresent(headers, 'dynamodb-sequence-number', record.dynamodb?.SequenceNumber);
    addIfPresent(headers, 'dynamodb-stream-view-type', record.dynamodb?.StreamViewType);
    addIfPresent(headers, 'dynamodb-event-source-arn', record.eventSourceARN);
    addIfPresent(headers, 'dynamodb-aws-region', record.awsRegion);

    return headers;
  }
}

function addIfPresent(
  headers: Record<string, string>,
  key: string,
  value: string | undefined,
): void {
  if (value !== undefined && value !== '') {
    headers[key] = value;
  }
}

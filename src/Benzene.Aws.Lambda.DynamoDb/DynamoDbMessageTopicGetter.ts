/** Port of Benzene.Aws.Lambda.DynamoDb.DynamoDbMessageTopicGetter. */
import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { Topic } from '@benzene/core-messages';
import { DynamoDbRecordContext } from './DynamoDbRecordContext';
import { DynamoDbUtils } from './DynamoDbUtils';

/**
 * Resolves the message topic as `"{tableName}:{eventName}"` (plan decision DS2), e.g. `orders:INSERT` —
 * the two things that identify a change-data-capture event: which table and what happened. A handler
 * declares `@message('orders:INSERT')`. When the stream ARN can't be parsed, falls back to the bare event
 * name. PascalCase mapping: C# `context.Record.EventSourceArn` / `context.Record.EventName` become
 * `record.eventSourceARN` / `record.eventName` (the record envelope is camelCase in `@types/aws-lambda`).
 */
export class DynamoDbMessageTopicGetter implements IMessageTopicGetter<DynamoDbRecordContext> {
  getTopic(context: DynamoDbRecordContext): ITopic | undefined {
    const tableName = DynamoDbUtils.getTableName(context.record.eventSourceARN);
    const eventName = context.record.eventName;

    return new Topic(tableName !== undefined ? `${tableName}:${eventName}` : eventName);
  }
}

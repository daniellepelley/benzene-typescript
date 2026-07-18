/** Port of Benzene.Aws.Lambda.DynamoDb.DynamoDbMessageBodyGetter. */
import { IMessageBodyGetter } from '@benzene/abstractions-messages';
import { DynamoDbAttributeValueConverter } from './DynamoDbAttributeValueConverter';
import { DynamoDbRecordContext } from './DynamoDbRecordContext';

/**
 * Extracts the message body as plain JSON unmarshalled from the record's AttributeValue-format image
 * (plan decision DS3): `NewImage` when present, else `OldImage` (REMOVE events), else `Keys` (KEYS_ONLY
 * stream views) — the most complete state available. PascalCase mapping: C# `data.NewImage` /
 * `data.OldImage` / `data.Keys` become `record.dynamodb.NewImage` / `.OldImage` / `.Keys`.
 */
export class DynamoDbMessageBodyGetter implements IMessageBodyGetter<DynamoDbRecordContext> {
  getBody(context: DynamoDbRecordContext): string | undefined {
    const data = context.record.dynamodb;
    if (data === undefined) {
      return undefined;
    }

    const image = data.NewImage ?? data.OldImage ?? data.Keys;
    return image !== undefined ? DynamoDbAttributeValueConverter.toJson(image) : undefined;
  }
}

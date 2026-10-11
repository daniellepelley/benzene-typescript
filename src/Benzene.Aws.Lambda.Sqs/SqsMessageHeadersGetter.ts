import { IMessageHeadersGetter } from '@benzenejs/abstractions-messages';
import { withoutMetadataKey } from '@benzenejs/core-messages';
import { SqsMessageContext } from './SqsMessageContext';
import { SqsMessageTopicGetter } from './SqsMessageTopicGetter';

/**
 * Port of Benzene.Aws.Lambda.Sqs.SqsMessageHeadersGetter.
 *
 * Extracts headers from an SQS record's string-typed message attributes. PascalCase -> camelCase:
 * C# `SqsMessage.MessageAttributes` / `.Value.DataType` / `.Value.StringValue` become
 * `sqsMessage.messageAttributes` / `.dataType` / `.stringValue`. Only attributes whose `dataType` is
 * `"String"` are included, matching the .NET filter. The configured topic key is consumed: it is the topic,
 * not a header (transport-metadata-cases.json `headersExclude`), so it is left out here, matched
 * case-insensitively like the topic getter reads it.
 */
export class SqsMessageHeadersGetter implements IMessageHeadersGetter<SqsMessageContext> {
  constructor(private readonly topicAttributeKey: string = SqsMessageTopicGetter.DefaultTopicAttribute) {}

  getHeaders(context: SqsMessageContext): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [key, attribute] of Object.entries(context.sqsMessage.messageAttributes)) {
      if (attribute.dataType === 'String' && attribute.stringValue !== undefined) {
        headers[key] = attribute.stringValue;
      }
    }
    return withoutMetadataKey(headers, this.topicAttributeKey);
  }
}

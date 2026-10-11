/** Port of Benzene.Aws.Sqs.Consumer.SqsConsumerMessageHeadersGetter. */
import { IMessageHeadersGetter } from '@benzenejs/abstractions-messages';
import { withoutMetadataKey } from '@benzenejs/core-messages';
import { SqsConsumerMessageTopicGetter } from './SqsConsumerMessageTopicGetter';
import { SqsConsumerMessageContext } from './SqsConsumerMessageContext';

/**
 * Extracts headers from an SQS message's string-typed message attributes. The configured topic key is consumed: it is the topic,
 * not a header (transport-metadata-cases.json `headersExclude`), so it is left out here, matched
 * case-insensitively like the topic getter reads it.
 */
export class SqsConsumerMessageHeadersGetter implements IMessageHeadersGetter<SqsConsumerMessageContext> {
  constructor(private readonly topicAttributeKey: string = SqsConsumerMessageTopicGetter.DefaultTopicAttribute) {}

  getHeaders(context: SqsConsumerMessageContext): Record<string, string> {
    const headers: Record<string, string> = {};
    const attributes = context.message.MessageAttributes;
    if (attributes !== undefined) {
      for (const [name, value] of Object.entries(attributes)) {
        if (value.DataType === 'String' && value.StringValue !== undefined) {
          headers[name] = value.StringValue;
        }
      }
    }
    return withoutMetadataKey(headers, this.topicAttributeKey);
  }
}

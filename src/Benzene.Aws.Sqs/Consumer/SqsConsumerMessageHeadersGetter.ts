/** Port of Benzene.Aws.Sqs.Consumer.SqsConsumerMessageHeadersGetter. */
import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { SqsConsumerMessageContext } from './SqsConsumerMessageContext';

/** Extracts headers from an SQS message's string-typed message attributes. */
export class SqsConsumerMessageHeadersGetter implements IMessageHeadersGetter<SqsConsumerMessageContext> {
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
    return headers;
  }
}

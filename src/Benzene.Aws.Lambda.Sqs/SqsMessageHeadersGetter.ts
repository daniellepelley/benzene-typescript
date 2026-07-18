import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { SqsMessageContext } from './SqsMessageContext';

/**
 * Port of Benzene.Aws.Lambda.Sqs.SqsMessageHeadersGetter.
 *
 * Extracts headers from an SQS record's string-typed message attributes. PascalCase -> camelCase:
 * C# `SqsMessage.MessageAttributes` / `.Value.DataType` / `.Value.StringValue` become
 * `sqsMessage.messageAttributes` / `.dataType` / `.stringValue`. Only attributes whose `dataType` is
 * `"String"` are included, matching the .NET filter.
 */
export class SqsMessageHeadersGetter implements IMessageHeadersGetter<SqsMessageContext> {
  getHeaders(context: SqsMessageContext): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [key, attribute] of Object.entries(context.sqsMessage.messageAttributes)) {
      if (attribute.dataType === 'String' && attribute.stringValue !== undefined) {
        headers[key] = attribute.stringValue;
      }
    }
    return headers;
  }
}

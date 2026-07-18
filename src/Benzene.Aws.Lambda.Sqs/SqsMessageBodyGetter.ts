import { IMessageBodyGetter } from '@benzene/abstractions-messages';
import { SqsMessageContext } from './SqsMessageContext';

/**
 * Port of Benzene.Aws.Lambda.Sqs.SqsMessageBodyGetter.
 *
 * Extracts the raw body string from an SQS record. PascalCase -> camelCase: C# `SqsMessage.Body`
 * becomes `sqsMessage.body`.
 */
export class SqsMessageBodyGetter implements IMessageBodyGetter<SqsMessageContext> {
  getBody(context: SqsMessageContext): string | undefined {
    return context.sqsMessage.body;
  }
}

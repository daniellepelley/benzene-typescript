/** Port of Benzene.Aws.Sqs.Consumer.SqsConsumerMessageBodyGetter (SqsMessageBodyMapper.cs). */
import { IMessageBodyGetter } from '@benzenejs/abstractions-messages';
import { SqsConsumerMessageContext } from './SqsConsumerMessageContext';

/** Extracts the raw body string from an SQS message received by the polling consumer. */
export class SqsConsumerMessageBodyGetter implements IMessageBodyGetter<SqsConsumerMessageContext> {
  getBody(context: SqsConsumerMessageContext): string {
    return context.message.Body ?? '';
  }
}

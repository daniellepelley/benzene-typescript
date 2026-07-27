/** Port of Benzene.Aws.Sqs.Consumer.SqsConsumerMessageTopicGetter (SqsMessageTopicMapper.cs). */
import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { Topic } from '@benzene/core-messages';
import { SqsConsumerMessageContext } from './SqsConsumerMessageContext';

/**
 * Extracts the message topic from an SQS message's topic message attribute. `Message.MessageAttributes[key]
 * .StringValue` (aws-sdk PascalCase), defaulting to the `"topic"` attribute.
 */
export class SqsConsumerMessageTopicGetter implements IMessageTopicGetter<SqsConsumerMessageContext> {
  /** The default message-attribute key the topic is read from. */
  static readonly DefaultTopicAttribute = 'topic';

  constructor(private readonly topicAttributeKey: string = SqsConsumerMessageTopicGetter.DefaultTopicAttribute) {}

  getTopic(context: SqsConsumerMessageContext): ITopic | undefined {
    return new Topic(this.getFromAttributes(context, this.topicAttributeKey));
  }

  private getFromAttributes(context: SqsConsumerMessageContext, key: string): string | undefined {
    return context.message.MessageAttributes?.[key]?.StringValue;
  }
}

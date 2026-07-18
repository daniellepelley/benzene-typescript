import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { Topic } from '@benzene/core-messages';
import { SqsMessageContext } from './SqsMessageContext';

/**
 * Port of Benzene.Aws.Lambda.Sqs.SqsMessageTopicGetter.
 *
 * Extracts the message topic from an SQS record's `topic` message attribute. PascalCase -> camelCase:
 * C# `SqsMessage.MessageAttributes[key].StringValue` becomes
 * `sqsMessage.messageAttributes[key].stringValue`.
 */
export class SqsMessageTopicGetter implements IMessageTopicGetter<SqsMessageContext> {
  /** Returns the topic from the `topic` attribute, or a topic with a missing id if it is absent. */
  getTopic(context: SqsMessageContext): ITopic | undefined {
    return new Topic(SqsMessageTopicGetter.getFromAttributes(context, 'topic'));
  }

  private static getFromAttributes(context: SqsMessageContext, key: string): string | undefined {
    const attribute = context.sqsMessage.messageAttributes[key];
    if (attribute === undefined) {
      return undefined;
    }

    return attribute.stringValue;
  }
}

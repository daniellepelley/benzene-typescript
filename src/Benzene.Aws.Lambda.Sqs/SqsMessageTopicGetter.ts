import { IMessageTopicGetter } from '@benzenejs/abstractions-message-handlers';
import { ITopic } from '@benzenejs/abstractions-messages';
import { Topic } from '@benzenejs/core-messages';
import { SqsMessageContext } from './SqsMessageContext';

/**
 * Port of Benzene.Aws.Lambda.Sqs.SqsMessageTopicGetter.
 *
 * Extracts the message topic from an SQS record's `topic` message attribute. PascalCase -> camelCase:
 * C# `SqsMessage.MessageAttributes[key].StringValue` becomes
 * `sqsMessage.messageAttributes[key].stringValue`.
 */
export class SqsMessageTopicGetter implements IMessageTopicGetter<SqsMessageContext> {
  /**
   * The default message-attribute key the topic is read from (`topic`) — the spec's reserved topic
   * name (wire-contracts.md §2). Port of the C# `SqsMessageTopicGetter.DefaultTopicAttribute` constant,
   * which aliases `BenzeneWireNames.DefaultTopic`; the TS port has no `BenzeneWireNames` type yet, so the
   * literal lives here (see README "Porting conventions").
   */
  static readonly DefaultTopicAttribute = 'topic';

  /** Returns the topic from the `topic` attribute, or a topic with a missing id if it is absent. */
  getTopic(context: SqsMessageContext): ITopic | undefined {
    return new Topic(
      SqsMessageTopicGetter.getFromAttributes(context, SqsMessageTopicGetter.DefaultTopicAttribute),
    );
  }

  private static getFromAttributes(context: SqsMessageContext, key: string): string | undefined {
    const attribute = context.sqsMessage.messageAttributes[key];
    if (attribute === undefined) {
      return undefined;
    }

    return attribute.stringValue;
  }
}

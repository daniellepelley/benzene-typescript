import { IMessageTopicGetter } from '@benzenejs/abstractions-message-handlers';
import { ITopic } from '@benzenejs/abstractions-messages';
import { findMetadataValue, Topic } from '@benzenejs/core-messages';
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

  /**
   * @param topicAttributeKey The message attribute the topic is read from - {@link DefaultTopicAttribute}
   * unless the service renamed it (wire-contracts.md §2: reserved names are configurable).
   */
  constructor(private readonly topicAttributeKey: string = SqsMessageTopicGetter.DefaultTopicAttribute) {}

  /**
   * Returns the topic from the topic attribute (its key matched case-insensitively), or a topic with a
   * missing id if it is absent.
   */
  getTopic(context: SqsMessageContext): ITopic | undefined {
    return new Topic(findMetadataValue(context.sqsMessage.messageAttributes, this.topicAttributeKey)?.stringValue);
  }
}

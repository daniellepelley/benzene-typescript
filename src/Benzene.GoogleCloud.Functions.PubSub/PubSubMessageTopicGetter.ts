/** Port of Benzene.GoogleCloud.Functions.PubSub.PubSubMessageTopicGetter. */
import { IMessageTopicGetter } from '@benzenejs/abstractions-message-handlers';
import { ITopic } from '@benzenejs/abstractions-messages';
import { Topic } from '@benzenejs/core-messages';
import { PubSubContext } from './PubSubContext';

/**
 * Extracts the message topic from a Pub/Sub message's `"topic"` attribute — the same "topic in a custom
 * attribute" convention used by SQS/SNS/Service Bus, since Pub/Sub has no native per-message "topic"
 * concept of its own (a Pub/Sub topic is the publish destination, not a per-message routing key).
 *
 * The attribute key is a configurable default, not hard-coded: pass a different key to the constructor
 * (or via `addGooglePubSub(services, topicAttributeKey)` / `usePubSub(..., topicAttributeKey)`) to
 * consume messages a non-Benzene producer routes on another attribute. A missing attribute yields
 * `undefined`, which `Topic` maps to the `<missing>` id (C# `Constants.Missing`).
 */
export class PubSubMessageTopicGetter implements IMessageTopicGetter<PubSubContext> {
  /** The default message-attribute key the topic is read from (C# `DefaultTopicAttribute`). */
  static readonly DefaultTopicAttribute = 'topic';

  private readonly topicAttributeKey: string;

  /**
   * @param topicAttributeKey The message attribute the topic is carried on. Defaults to
   *   {@link PubSubMessageTopicGetter.DefaultTopicAttribute} (`"topic"`).
   */
  constructor(topicAttributeKey: string = PubSubMessageTopicGetter.DefaultTopicAttribute) {
    this.topicAttributeKey = topicAttributeKey;
  }

  getTopic(context: PubSubContext): ITopic | undefined {
    return new Topic(this.getTopicAttribute(context));
  }

  private getTopicAttribute(context: PubSubContext): string | undefined {
    return context.message.attributes?.[this.topicAttributeKey];
  }
}

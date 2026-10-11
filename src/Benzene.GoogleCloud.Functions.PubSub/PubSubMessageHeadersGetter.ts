/** Port of Benzene.GoogleCloud.Functions.PubSub.PubSubMessageHeadersGetter. */
import { IMessageHeadersGetter } from '@benzenejs/abstractions-messages';
import { withoutMetadataKey } from '@benzenejs/core-messages';
import { PubSubMessageTopicGetter } from './PubSubMessageTopicGetter';
import { PubSubContext } from './PubSubContext';

/**
 * Extracts headers from a Pub/Sub message's attributes.
 *
 * C# `context.Message.Attributes.ToDictionary(...)` becomes a shallow copy of `message.attributes`
 * (`IDictionary<string, string>` → `Record<string, string>`); an absent `attributes` yields `{}`.
 */
export class PubSubMessageHeadersGetter implements IMessageHeadersGetter<PubSubContext> {
  constructor(private readonly topicAttributeKey: string = PubSubMessageTopicGetter.DefaultTopicAttribute) {}

  getHeaders(context: PubSubContext): Record<string, string> {
    return withoutMetadataKey({ ...(context.message.attributes ?? {}) }, this.topicAttributeKey);
  }
}

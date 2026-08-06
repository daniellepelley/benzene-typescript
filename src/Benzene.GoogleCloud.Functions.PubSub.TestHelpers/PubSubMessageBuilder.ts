/** Port of Benzene.GoogleCloud.Functions.PubSub.TestHelpers.PubSubMessageBuilder. */
import {
  MessagePublishedData,
  PubSubMessageTopicGetter,
} from '@benzene/google-cloud-functions-pubsub';

/**
 * Builds a {@link MessagePublishedData} for tests that dispatch straight into a Pub/Sub host via
 * `host.sendPubSubAsync(...)`, without a live Cloud Functions Framework host or a real Pub/Sub
 * subscription. The fluent counterpart of {@link asPubSubEvent} for tests that want to set the raw body /
 * message ID / subscription directly. Port of the C# `PubSubMessageBuilder`.
 *
 * MESSAGE-TYPE ADAPTATION: like {@link asPubSubEvent}, `build()` base64-encodes the body into
 * `message.data` (the CloudEvent-JSON shape the TS {@link MessagePublishedData} models), matching what
 * `PubSubMessageBodyGetter` decodes — where the C# stored raw UTF-8 bytes in a protobuf `ByteString`.
 */
export class PubSubMessageBuilder {
  private readonly attributes: Record<string, string> = {};
  private body = '';
  private messageId: string = crypto.randomUUID();
  private subscription = 'projects/test-project/subscriptions/test-subscription';

  /** Serializes `message` as JSON and uses it as the message body. Port of C# `WithBody`. */
  withBody(message: unknown): this {
    this.body = JSON.stringify(message);
    return this;
  }

  /** Uses `body` verbatim as the message body. Port of C# `WithRawBody`. */
  withRawBody(body: string): this {
    this.body = body;
    return this;
  }

  /** Adds a message attribute. Port of C# `WithAttribute`. */
  withAttribute(key: string, value: string): this {
    this.attributes[key] = value;
    return this;
  }

  /**
   * Sets the `"topic"` attribute {@link PubSubMessageTopicGetter} reads for routing (via
   * {@link PubSubMessageTopicGetter.DefaultTopicAttribute}). Port of C# `WithTopic`.
   */
  withTopic(topic: string): this {
    return this.withAttribute(PubSubMessageTopicGetter.DefaultTopicAttribute, topic);
  }

  /** Sets the Pub/Sub message ID. Port of C# `WithMessageId`. */
  withMessageId(messageId: string): this {
    this.messageId = messageId;
    return this;
  }

  /** Sets the subscription this message is being delivered on. Port of C# `WithSubscription`. */
  withSubscription(subscription: string): this {
    this.subscription = subscription;
    return this;
  }

  /** Builds the {@link MessagePublishedData} with the configured message and subscription. Port of C# `Build`. */
  build(): MessagePublishedData {
    return {
      message: {
        data: Buffer.from(this.body, 'utf8').toString('base64'),
        messageId: this.messageId,
        attributes: { ...this.attributes },
      },
      subscription: this.subscription,
    };
  }
}

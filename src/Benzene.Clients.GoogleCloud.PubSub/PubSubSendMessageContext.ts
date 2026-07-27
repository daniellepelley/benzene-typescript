/** Port of Benzene.Clients.GoogleCloud.PubSub.PubSubSendMessageContext. */

/**
 * The message shape passed to `@google-cloud/pubsub`'s `Topic.publishMessage` — structurally the SDK's
 * `MessageOptions` (`PubsubMessage`), narrowed to the fields Benzene sets. `Google.Protobuf.ByteString`
 * data maps to a `Uint8Array`/`Buffer` (or a string).
 */
export interface PubSubPublishMessage {
  data?: Uint8Array | string;
  attributes?: Record<string, string>;
}

/**
 * The middleware pipeline context for publishing a single message to a Google Cloud Pub/Sub topic — the
 * outbound counterpart of the inbound `PubSubContext` in `@benzene/google-cloud-functions-pubsub`.
 *
 * MESSAGE-TYPE ADAPTATION: .NET's low-level `Google.Cloud.PubSub.V1` `TopicName` (a structured resource
 * name) + `PubsubMessage` map to a resolved topic-name `string` (what `@google-cloud/pubsub`'s
 * `PubSub.topic(name)` accepts) + a {@link PubSubPublishMessage}.
 */
export class PubSubSendMessageContext {
  /**
   * The server-assigned message id returned by the publish. Set by `PubSubClientMiddleware`; empty until
   * the message is published.
   */
  messageId = '';

  constructor(
    readonly topicName: string,
    readonly message: PubSubPublishMessage,
  ) {}
}

/**
 * The Pub/Sub CloudEvent payload types, ported from `Google.Events.Protobuf.Cloud.PubSub.V1`.
 *
 * MESSAGE-TYPE ADAPTATION: the .NET package depends on the generated protobuf types
 * (`MessagePublishedData` / `PubsubMessage`) from `Google.Events.Protobuf`. The Node Functions Framework
 * delivers a CloudEvent whose `data` is the already-JSON-deserialized `MessagePublishedData` and ships no
 * framework type for it (its `CloudEvent<T>` is generic over `unknown`). So — like the AWS adapters, which
 * model the already-parsed Lambda event rather than a stream — the port declares these small structural
 * interfaces matching the CloudEvent Pub/Sub JSON shape, rather than pulling in a protobuf runtime. The
 * one convenience the generated `PubsubMessage.TextData` gave for free (UTF-8 decode of the base64 `Data`)
 * is re-created in `PubSubMessageBodyGetter`.
 */

/** A single Pub/Sub message, as carried in a Pub/Sub CloudEvent's `message` field. */
export interface PubsubMessage {
  /** The message payload, base64-encoded (the CloudEvent JSON encoding of Pub/Sub's binary `data`). */
  data?: string;
  /** The message's attributes — used both as Benzene headers and as the topic-routing source. */
  attributes?: Record<string, string>;
  /** The Pub/Sub-assigned message ID (`messageId` in the CloudEvent JSON). */
  messageId?: string;
  /**
   * The message ID under the legacy snake_case key some Pub/Sub encodings use. Read as a fallback so a
   * message ID is available for `PubSubMessageProcessingException` regardless of encoding.
   */
  message_id?: string;
  /** The time the message was published (RFC 3339). Unused by routing; present for completeness. */
  publishTime?: string;
  /** The message's ordering key, when publisher ordering is enabled. */
  orderingKey?: string;
}

/** The `data` payload of a Pub/Sub CloudEvent — the message plus the subscription it was delivered on. */
export interface MessagePublishedData {
  /** The Pub/Sub message this invocation was delivered for. */
  message: PubsubMessage;
  /** The subscription the message was delivered on. */
  subscription?: string;
}

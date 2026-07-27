/** Port of Benzene.GoogleCloud.Functions.PubSub.PubSubContext. */
import { IHasMessageResult, IMessageResult } from '@benzene/abstractions-message-handlers';
import { MessagePublishedData, PubsubMessage } from './MessagePublishedData';

/**
 * The middleware pipeline context for a single Pub/Sub message delivered to a Cloud Functions Gen2
 * CloudEvent trigger. Google Cloud Functions delivers EXACTLY ONE Pub/Sub message per invocation
 * (a CloudEvent), unlike AWS/Azure's batch-oriented triggers — so this is structurally closer to a
 * single HTTP request than to Kafka/SNS's per-record batch loop.
 *
 * Implements the already-ported `IHasMessageResult` so `PubSubMessageHandlerResultSetter` can record the
 * handler outcome onto it (read by `PubSubMiddlewareApplication` for `PubSubOptions.raiseOnFailureStatus`).
 */
export class PubSubContext implements IHasMessageResult {
  /**
   * @param data The Pub/Sub CloudEvent payload for this invocation.
   */
  constructor(readonly data: MessagePublishedData) {}

  /** The Pub/Sub message this invocation was delivered for. */
  get message(): PubsubMessage {
    return this.data.message;
  }

  /**
   * The result of handling this message. Set by `PubSubMessageHandlerResultSetter`; unset (C# `null`)
   * until a result has been recorded — `PubSubMiddlewareApplication` reads it via optional chaining,
   * exactly as C# reads `MessageResult?.IsSuccessful`.
   */
  messageResult!: IMessageResult;
}

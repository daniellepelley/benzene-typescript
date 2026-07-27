/** Port of Benzene.GoogleCloud.Functions.PubSub.PubSubMessageProcessingException. */

/**
 * Thrown by `PubSubMiddlewareApplication` when `PubSubOptions.raiseOnFailureStatus` is enabled and a
 * message handler reported an unsuccessful result without itself throwing — escalating the failure into
 * an exception so it's treated the same as an unhandled exception for retry purposes (the Functions
 * Framework turns it into a non-2xx response, so the subscription's retry/dead-letter policy notices).
 * C# `Exception` maps to `Error`.
 */
export class PubSubMessageProcessingException extends Error {
  /** The Pub/Sub message ID of the failing message. */
  readonly messageId: string;

  constructor(messageId: string) {
    super(`Message handler reported an unsuccessful result for Pub/Sub message ${messageId}.`);
    this.name = 'PubSubMessageProcessingException';
    this.messageId = messageId;
  }
}

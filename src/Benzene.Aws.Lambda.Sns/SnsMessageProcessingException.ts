/** Port of Benzene.Aws.Lambda.Sns.SnsMessageProcessingException. */

/**
 * Thrown by `SnsApplication` when `SnsOptions.raiseOnFailureStatus` is enabled (the default) and a message
 * handler reported an unsuccessful result — or none — without itself throwing, escalating it so
 * SNS's own subscription retry policy applies the same way it would for an unhandled exception. C#
 * `Exception` maps to `Error`.
 */
export class SnsMessageProcessingException extends Error {
  /** The SNS message ID that the handler reported a failure for. */
  readonly messageId: string;

  constructor(messageId: string) {
    super(
      `SNS message ${messageId} was not processed successfully (a failure result, no result, or a topic no ` +
        'handler serves); failing the invocation so SNS redelivers it. Set ignoreUnmatchedTopics for a shared ' +
        'topic, or atMostOnce to acknowledge failures.',
    );
    this.name = 'SnsMessageProcessingException';
    this.messageId = messageId;
  }
}

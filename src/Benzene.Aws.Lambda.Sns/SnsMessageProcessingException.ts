/** Port of Benzene.Aws.Lambda.Sns.SnsMessageProcessingException. */

/**
 * Thrown by `SnsApplication` when `SnsOptions.raiseOnFailureStatus` is enabled and a message handler
 * reported an unsuccessful result without itself throwing — escalating the failure into an exception so
 * SNS's own subscription retry policy applies the same way it would for an unhandled exception. C#
 * `Exception` maps to `Error`.
 */
export class SnsMessageProcessingException extends Error {
  /** The SNS message ID that the handler reported a failure for. */
  readonly messageId: string;

  constructor(messageId: string) {
    super(`Message handler reported an unsuccessful result for SNS message ${messageId}.`);
    this.name = 'SnsMessageProcessingException';
    this.messageId = messageId;
  }
}

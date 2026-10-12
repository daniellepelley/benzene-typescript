import { PublishCommandInput, PublishCommandOutput } from '@aws-sdk/client-sns';

/**
 * The middleware pipeline context for publishing a single message to SNS.
 * Port of Benzene.Clients.Aws.Sns.SnsSendMessageContext (`PublishRequest`/`PublishResponse` -> the
 * `@aws-sdk/client-sns` v3 command input/output types).
 */
export class SnsSendMessageContext {
  /** The SNS publish response, set by `SnsClientMiddleware`. */
  response?: PublishCommandOutput;

  /**
   * Set instead of a completed send when the SDK call rejected before the broker accepted the message; the
   * outbound converter turns it into a failed result (`failedSendResult`, transport-bindings.md §1) rather
   * than letting the exception escape the send. A port addition.
   */
  transportFailure?: unknown;

  constructor(readonly request: PublishCommandInput) {}
}

import { SendMessageCommandInput, SendMessageCommandOutput } from '@aws-sdk/client-sqs';

/**
 * The middleware pipeline context for sending a single message to SQS.
 * Port of Benzene.Clients.Aws.Sqs.SqsSendMessageContext.
 *
 * `Amazon.SQS.Model.SendMessageRequest`/`SendMessageResponse` map to the `@aws-sdk/client-sqs` v3
 * command input/output types.
 */
export class SqsSendMessageContext {
  /** The SQS send response, set by `SqsClientMiddleware`. */
  response?: SendMessageCommandOutput;

  /**
   * Set instead of a completed send when the SDK call rejected before the broker accepted the message; the
   * outbound converter turns it into a failed result (`failedSendResult`, transport-bindings.md §1) rather
   * than letting the exception escape the send. A port addition.
   */
  transportFailure?: unknown;

  constructor(readonly request: SendMessageCommandInput) {}
}

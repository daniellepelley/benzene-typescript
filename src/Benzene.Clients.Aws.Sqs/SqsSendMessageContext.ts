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
   * The caller's abort signal for this send, if any — copied from `OutboundContext.signal` by the
   * converter and passed to the SDK call as `abortSignal` (the TS-idiomatic port of the ambient
   * `ICancellationTokenAccessor` token the .NET middleware threads into `SendMessageAsync`).
   */
  signal?: AbortSignal;

  constructor(readonly request: SendMessageCommandInput) {}
}

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
   * The caller's abort signal for this send, if any — copied from `OutboundContext.signal` by the
   * converter and passed to the SDK call as `abortSignal` (the TS-idiomatic port of the ambient
   * `ICancellationTokenAccessor` token the .NET middleware threads into `PublishAsync`).
   */
  signal?: AbortSignal;

  constructor(readonly request: PublishCommandInput) {}
}

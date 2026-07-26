import { PublishCommandInput, PublishCommandOutput } from '@aws-sdk/client-sns';

/**
 * The middleware pipeline context for publishing a single message to SNS.
 * Port of Benzene.Clients.Aws.Sns.SnsSendMessageContext (`PublishRequest`/`PublishResponse` -> the
 * `@aws-sdk/client-sns` v3 command input/output types).
 */
export class SnsSendMessageContext {
  /** The SNS publish response, set by `SnsClientMiddleware`. */
  response?: PublishCommandOutput;

  constructor(readonly request: PublishCommandInput) {}
}

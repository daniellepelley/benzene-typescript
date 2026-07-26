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

  constructor(readonly request: SendMessageCommandInput) {}
}

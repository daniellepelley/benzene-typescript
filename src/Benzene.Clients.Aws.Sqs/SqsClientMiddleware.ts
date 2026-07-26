import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { SqsSendMessageContext } from './SqsSendMessageContext';

/**
 * Terminal middleware that sends the context's request to SQS and records the response.
 * Port of Benzene.Clients.Aws.Sqs.SqsClientMiddleware.
 *
 * `IAmazonSQS.SendMessageAsync` -> `SQSClient.send(new SendMessageCommand(...))`. It does not call `next`.
 */
export class SqsClientMiddleware implements IMiddleware<SqsSendMessageContext> {
  readonly name = 'SqsClientMiddleware';

  constructor(private readonly amazonSqs: SQSClient) {}

  async handleAsync(context: SqsSendMessageContext, _next: NextFunc): Promise<void> {
    context.response = await this.amazonSqs.send(new SendMessageCommand(context.request));
  }
}

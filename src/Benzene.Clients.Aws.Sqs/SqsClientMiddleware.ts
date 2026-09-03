import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { IMiddleware, NextFunc } from '@benzenejs/abstractions-middleware';
import { SqsSendMessageContext } from './SqsSendMessageContext';

/**
 * Terminal middleware that sends the context's request to SQS and records the response.
 * Port of Benzene.Clients.Aws.Sqs.SqsClientMiddleware.
 *
 * `IAmazonSQS.SendMessageAsync` -> `SQSClient.send(new SendMessageCommand(...))`. It does not call `next`.
 * The context's abort signal (if set) is passed as the SDK call's `abortSignal`, so an aborted caller
 * aborts the outbound send instead of running it to completion — the port of .NET's ambient
 * `ICancellationTokenAccessor` token flowing into `SendMessageAsync`.
 */
export class SqsClientMiddleware implements IMiddleware<SqsSendMessageContext> {
  readonly name = 'SqsClientMiddleware';

  constructor(private readonly amazonSqs: SQSClient) {}

  async handleAsync(context: SqsSendMessageContext, _next: NextFunc): Promise<void> {
    context.response = await this.amazonSqs.send(new SendMessageCommand(context.request), {
      abortSignal: context.signal,
    });
  }
}

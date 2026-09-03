import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { IMiddleware, NextFunc } from '@benzenejs/abstractions-middleware';
import { SnsSendMessageContext } from './SnsSendMessageContext';

/**
 * Terminal middleware that publishes the context's request to SNS and records the response.
 * Port of Benzene.Clients.Aws.Sns.SnsClientMiddleware (`IAmazonSimpleNotificationService.PublishAsync`
 * -> `SNSClient.send(new PublishCommand(...))`). Does not call `next`. The context's abort signal
 * (if set) is passed as the SDK call's `abortSignal`, so an aborted caller aborts the outbound
 * publish instead of running it to completion.
 */
export class SnsClientMiddleware implements IMiddleware<SnsSendMessageContext> {
  readonly name = 'SnsClientMiddleware';

  constructor(private readonly amazonSns: SNSClient) {}

  async handleAsync(context: SnsSendMessageContext, _next: NextFunc): Promise<void> {
    context.response = await this.amazonSns.send(new PublishCommand(context.request), {
      abortSignal: context.signal,
    });
  }
}

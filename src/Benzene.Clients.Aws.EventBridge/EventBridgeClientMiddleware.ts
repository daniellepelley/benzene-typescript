import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { IMiddleware, NextFunc } from '@benzenejs/abstractions-middleware';
import { EventBridgeSendMessageContext } from './EventBridgeSendMessageContext';

/**
 * Terminal middleware that puts the context's event to EventBridge and records the response.
 * Port of Benzene.Clients.Aws.EventBridge.EventBridgeClientMiddleware
 * (`IAmazonEventBridge.PutEventsAsync` -> `EventBridgeClient.send(new PutEventsCommand(...))`). Does not call `next`.
 * The context's abort signal (if set) is passed as the SDK call's `abortSignal`, so an aborted caller
 * aborts the outbound put instead of running it to completion.
 */
export class EventBridgeClientMiddleware implements IMiddleware<EventBridgeSendMessageContext> {
  readonly name = 'EventBridgeClientMiddleware';

  constructor(private readonly amazonEventBridge: EventBridgeClient) {}

  async handleAsync(context: EventBridgeSendMessageContext, _next: NextFunc): Promise<void> {
    context.response = await this.amazonEventBridge.send(new PutEventsCommand(context.request), {
      abortSignal: context.signal,
    });
  }
}

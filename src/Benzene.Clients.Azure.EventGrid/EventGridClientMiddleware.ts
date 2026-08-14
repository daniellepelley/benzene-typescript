/** Port of Benzene.Clients.Azure.EventGrid.EventGridClientMiddleware. */
import { EventGridPublisherClient, InputSchema } from '@azure/eventgrid';
import { IMiddleware, NextFunc } from '@benzenejs/abstractions-middleware';
import { EventGridSendMessageContext } from './EventGridSendMessageContext';

/**
 * Terminal middleware that sends the context's event via an `EventGridPublisherClient` and records that
 * the send completed. It does not call `next`. `EventGridPublisherClient.SendEventAsync(event)` →
 * `client.send([event])`.
 *
 * PORTING NOTE: .NET's single `EventGridPublisherClient` accepts both CloudEvents and classic events;
 * `@azure/eventgrid`'s client is parameterized by schema at construction. The caller must therefore pair
 * a client configured for the matching schema with the matching converter (`useEventGrid` → a
 * `<"CloudEvent">` client, `useEventGridEventSchema` → an `<"EventGrid">` client) — the same "configure
 * the client's schema" responsibility the .NET caller has.
 */
export class EventGridClientMiddleware implements IMiddleware<EventGridSendMessageContext> {
  readonly name = 'EventGridClientMiddleware';

  constructor(private readonly publisherClient: EventGridPublisherClient<InputSchema>) {}

  async handleAsync(context: EventGridSendMessageContext, _next: NextFunc): Promise<void> {
    if (context.cloudEvent !== undefined) {
      await this.publisherClient.send([context.cloudEvent]);
    } else {
      await this.publisherClient.send([context.eventGridEvent!]);
    }
    context.isSent = true;
  }
}

/** Port of Benzene.Clients.Azure.EventGrid.OutboundEventGridEventSchemaContextConverter. */
import { SendEventGridEventInput } from '@azure/eventgrid';
import { VoidResult } from '@benzenejs/abstractions';
import { IContextConverter } from '@benzenejs/abstractions-middleware';
import { OutboundContext } from '@benzenejs/clients';
import { BenzeneResult } from '@benzenejs/results';
import { EventGridSendMessageContext } from './EventGridSendMessageContext';

/**
 * Converts an outbound `OutboundContext` into an `EventGridSendMessageContext` carrying a classic-schema
 * Event Grid event, so an outbound route can send via Azure Event Grid using the classic schema. The
 * `OutboundContext` counterpart of the (deferred) generic `EventGridEventSchemaContextConverter<T>`.
 *
 * The topic becomes both the event's `subject` and `eventType`; the routed message becomes its `data`.
 * The classic schema has no header bag — unlike the CloudEvents converter, headers are not forwarded.
 * (Same `data`-encoding bend as `OutboundEventGridContextConverter`: the SDK owns JSON-encoding.)
 */
export class OutboundEventGridEventSchemaContextConverter
  implements IContextConverter<OutboundContext, EventGridSendMessageContext>
{
  createRequestAsync(contextIn: OutboundContext): Promise<EventGridSendMessageContext> {
    const eventGridEvent: SendEventGridEventInput<unknown> = {
      subject: contextIn.topic,
      eventType: contextIn.topic,
      dataVersion: '1.0',
      data: contextIn.request,
    };
    return Promise.resolve(EventGridSendMessageContext.forEventGridEvent(eventGridEvent));
  }

  mapResponseAsync(contextIn: OutboundContext, _contextOut: EventGridSendMessageContext): Promise<void> {
    contextIn.response = BenzeneResult.accepted<VoidResult>(new VoidResult());
    return Promise.resolve();
  }
}

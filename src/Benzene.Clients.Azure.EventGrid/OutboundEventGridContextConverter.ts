/** Port of Benzene.Clients.Azure.EventGrid.OutboundEventGridContextConverter. */
import { SendCloudEventInput } from '@azure/eventgrid';
import { VoidResult } from '@benzene/abstractions';
import { IContextConverter } from '@benzene/abstractions-middleware';
import { OutboundContext } from '@benzene/clients';
import { BenzeneResult } from '@benzene/results';
import { EventGridSendMessageContext } from './EventGridSendMessageContext';

/**
 * Converts an outbound `OutboundContext` into an `EventGridSendMessageContext` carrying a CloudEvents 1.0
 * event, so an outbound route (`OutboundRoutingBuilder.route`) can send via Azure Event Grid. The
 * `OutboundContext` counterpart of the (deferred) generic `EventGridContextConverter<T>`.
 *
 * Event Grid has no request/response semantics beyond a send acknowledgement, so the mapped response is
 * always an accepted `VoidResult`-typed `IBenzeneResult`. The topic becomes the CloudEvent `type`, the
 * routed message becomes its `data`, and headers are forwarded as (lower-cased) extension attributes.
 *
 * PORTING BEND: .NET serializes the request to `BinaryData` with `CloudEventDataFormat.Json`. In JS the
 * Event Grid SDK owns JSON-encoding the CloudEvent `data` value, so the request object is passed as
 * `data` directly (the wire result is identical to Benzene's JSON serializer) — the converter therefore
 * takes no `ISerializer`.
 */
export class OutboundEventGridContextConverter
  implements IContextConverter<OutboundContext, EventGridSendMessageContext>
{
  constructor(private readonly source: string) {}

  createRequestAsync(contextIn: OutboundContext): Promise<EventGridSendMessageContext> {
    const extensionAttributes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(contextIn.headers)) {
      // CloudEvent extension attribute names must be lower-case (C# `ToLowerInvariant`).
      extensionAttributes[key.toLowerCase()] = value;
    }

    const cloudEvent: SendCloudEventInput<unknown> = {
      type: contextIn.topic,
      source: this.source,
      data: contextIn.request,
      datacontenttype: 'application/json',
      extensionAttributes,
    };
    return Promise.resolve(EventGridSendMessageContext.forCloudEvent(cloudEvent));
  }

  mapResponseAsync(contextIn: OutboundContext, _contextOut: EventGridSendMessageContext): Promise<void> {
    contextIn.response = BenzeneResult.accepted<VoidResult>(new VoidResult());
    return Promise.resolve();
  }
}

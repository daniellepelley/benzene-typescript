import { EventGridPublisherClient, InputSchema } from '@azure/eventgrid';
import { IMiddlewarePipelineBuilder } from '@benzenejs/abstractions-middleware';
import { OutboundContext } from '@benzenejs/clients';
import { EventGridClientMiddleware } from './EventGridClientMiddleware';
import { EventGridSendMessageContext } from './EventGridSendMessageContext';
import { OutboundEventGridContextConverter } from './OutboundEventGridContextConverter';
import { OutboundEventGridEventSchemaContextConverter } from './OutboundEventGridEventSchemaContextConverter';

/**
 * Port of Benzene.Clients.Azure.EventGrid.Extensions (C# fluent extension methods -> free functions
 * taking the builder first).
 *
 * PORT SCOPE: like the `@benzenejs/clients-*` siblings, this ports the `OutboundContext` send path; the
 * generic `IBenzeneClientContext<T,Void>` overloads and the standalone `EventGridBenzeneMessageClient`
 * are deferred (see the README structure table); the native `EventGridBatchMessageClient` IS ported.
 * Two converters are exposed, matching .NET: CloudEvents (`useEventGrid`, the preferred schema) and the classic Event
 * Grid schema (`useEventGridEventSchema`). The publisher client must be configured for the matching
 * schema (`@azure/eventgrid` types the client by schema at construction) — the same responsibility the
 * .NET caller has.
 */

/** Appends the terminal `EventGridClientMiddleware` (built from `publisherClient`) to a send pipeline. */
export function useEventGridClient(
  app: IMiddlewarePipelineBuilder<EventGridSendMessageContext>,
  publisherClient: EventGridPublisherClient<InputSchema>,
): IMiddlewarePipelineBuilder<EventGridSendMessageContext> {
  return app.use(() => new EventGridClientMiddleware(publisherClient));
}

/**
 * Converts an outbound route pipeline (`OutboundRoutingBuilder.route`) to send via Event Grid as a
 * CloudEvents 1.0 event: the topic becomes the CloudEvent `type`, the routed message its `data`, headers
 * its extension attributes. Pass a publisher client configured for the `"CloudEvent"` schema.
 */
export function useEventGrid(
  app: IMiddlewarePipelineBuilder<OutboundContext>,
  publisherClient: EventGridPublisherClient<InputSchema>,
  source: string,
): IMiddlewarePipelineBuilder<OutboundContext> {
  return app.convert(new OutboundEventGridContextConverter(source), (builder) =>
    useEventGridClient(builder, publisherClient),
  );
}

/**
 * Converts an outbound route pipeline to send via Event Grid using the classic Event Grid schema: the
 * topic becomes the event `subject` and `eventType`, the routed message its `data` (no headers). Pass a
 * publisher client configured for the `"EventGrid"` schema.
 */
export function useEventGridEventSchema(
  app: IMiddlewarePipelineBuilder<OutboundContext>,
  publisherClient: EventGridPublisherClient<InputSchema>,
): IMiddlewarePipelineBuilder<OutboundContext> {
  return app.convert(new OutboundEventGridEventSchemaContextConverter(), (builder) =>
    useEventGridClient(builder, publisherClient),
  );
}

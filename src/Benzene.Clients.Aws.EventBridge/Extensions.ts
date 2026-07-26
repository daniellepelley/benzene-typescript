import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { OutboundContext } from '@benzene/clients';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { EventBridgeClientMiddleware } from './EventBridgeClientMiddleware';
import { EventBridgeSendMessageContext } from './EventBridgeSendMessageContext';
import { OutboundEventBridgeContextConverter } from './OutboundEventBridgeContextConverter';

/**
 * Port of Benzene.Clients.Aws.EventBridge.Extensions (fluent extension methods -> builder-first free
 * functions). PORT DIVERGENCE: the `EventBridgeClient` is passed explicitly rather than resolved from the
 * container (see the SQS package's note).
 */
export function useEventBridgeClient(
  app: IMiddlewarePipelineBuilder<EventBridgeSendMessageContext>,
  amazonEventBridge: EventBridgeClient,
): IMiddlewarePipelineBuilder<EventBridgeSendMessageContext> {
  return app.use(() => new EventBridgeClientMiddleware(amazonEventBridge));
}

/**
 * Converts an outbound route pipeline to publish via EventBridge: the topic becomes the event `DetailType`,
 * `source` the event `Source`, and the routed message (plus embedded headers) the `Detail`.
 */
export function useEventBridge(
  app: IMiddlewarePipelineBuilder<OutboundContext>,
  source: string,
  amazonEventBridge: EventBridgeClient,
  eventBusName?: string,
): IMiddlewarePipelineBuilder<OutboundContext> {
  return app.convert(new OutboundEventBridgeContextConverter(source, eventBusName), (builder) =>
    useEventBridgeClient(builder, amazonEventBridge),
  );
}

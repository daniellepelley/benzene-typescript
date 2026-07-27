import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { OutboundContext } from '@benzene/clients';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { addDependencyHealthCheck, IHealthCheckBuilder } from '@benzene/health-checks-core';
import { EventBridgeClientMiddleware } from './EventBridgeClientMiddleware';
import { EventBridgeHealthCheck, defaultEventBusName } from './EventBridgeHealthCheck';
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
  healthCheck = true,
): IMiddlewarePipelineBuilder<OutboundContext> {
  // Auto-register a non-destructive EventBridge reachability check for the bus on the DEPENDENCY
  // category (deep healthcheck layer / mesh only, never a Kubernetes probe). Deduped by
  // `EventBridge:<bus>`; reuses this pipeline's client. Pass `healthCheck: false` to opt out. Mirrors
  // .NET's `UseEventBridge`.
  if (healthCheck) {
    const bus = eventBusName === undefined || eventBusName === '' ? defaultEventBusName : eventBusName;
    app.register((container) =>
      addDependencyHealthCheck(
        container,
        () => new EventBridgeHealthCheck(amazonEventBridge, bus),
        `EventBridge:${bus}`,
      ),
    );
  }
  return app.convert(new OutboundEventBridgeContextConverter(source, eventBusName), (builder) =>
    useEventBridgeClient(builder, amazonEventBridge),
  );
}

/**
 * Adds an EventBridge event-bus health check to a health-check builder explicitly — a non-destructive
 * read-only `DescribeEventBus` probe. Mirrors .NET's `AddEventBridgeHealthCheck` (takes the client
 * explicitly). An empty/undefined `eventBusName` targets the account's default bus.
 */
export function addEventBridgeHealthCheck(
  builder: IHealthCheckBuilder,
  amazonEventBridge: EventBridgeClient,
  eventBusName?: string,
): IHealthCheckBuilder {
  return builder.addHealthCheckFn(() => new EventBridgeHealthCheck(amazonEventBridge, eventBusName));
}

/** Port of Benzene.Azure.Function.EventHub.Function.EventHubApplication. */
import { ReceivedEventData } from '@azure/event-hubs';
import { IServiceResolverFactory } from '@benzene/abstractions';
import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { EntryPointMiddlewareApplication, MiddlewareMultiApplication } from '@benzene/core-middleware';
import { TransportMiddlewarePipeline } from '@benzene/core-message-handlers';
import { EventHubContext } from './EventHubContext';

/**
 * The entry point application for an Event Hub-triggered Azure Function. Maps each event in the triggered
 * batch to an `EventHubContext` and runs them all through the middleware pipeline, tagging the transport
 * as `"event-hub"` for the duration.
 *
 * FAITHFUL to the C#: `EventHubApplication : EntryPointMiddlewareApplication<EventData[]>` wrapping a
 * `MiddlewareMultiApplication<EventData[], EventHubContext>` over a `TransportMiddlewarePipeline<
 * EventHubContext>("event-hub", ...)`. All three are already ported; the batch type is the Node received
 * type `ReceivedEventData[]`. `MiddlewareMultiApplication` runs each mapped context in its own DI scope
 * concurrently (`Promise.all` / C# `Task.WhenAll`), which is exactly the C# behavior. `AzureFunctionApp`
 * dispatches to it via the fire-and-forget `handleAsync` path.
 *
 * MAPPER note: C# `@event.Select(EventHubContext.CreateInstance).ToArray()` becomes `events.map((e) =>
 * EventHubContext.createInstance(e))` (wrapped in an arrow so `Array.map`'s extra index/array arguments
 * aren't forwarded to the single-parameter factory).
 */
export class EventHubApplication extends EntryPointMiddlewareApplication<ReceivedEventData[]> {
  /**
   * @param pipeline The built Event Hub middleware pipeline to run each event through.
   * @param serviceResolverFactory The service resolver factory used to process each batch.
   */
  constructor(
    pipeline: IMiddlewarePipeline<EventHubContext>,
    serviceResolverFactory: IServiceResolverFactory,
  ) {
    super(
      new MiddlewareMultiApplication<ReceivedEventData[], EventHubContext>(
        new TransportMiddlewarePipeline<EventHubContext>('event-hub', pipeline),
        (events) => events.map((e) => EventHubContext.createInstance(e)),
      ),
      serviceResolverFactory,
    );
  }
}

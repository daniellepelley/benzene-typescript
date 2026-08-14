/** Port of Benzene.Azure.EventHub.TestHelpers.EventHubWorkerBenzeneTestHost. */
import type { ReceivedEventData } from '@azure/event-hubs';
import { IServiceResolverFactory } from '@benzenejs/abstractions';
import { IMessageResult } from '@benzenejs/abstractions-message-handlers';
import { EventHubConsumerApplication } from '@benzenejs/azure-event-hub';

/**
 * A test host that drives the Event Hub consumer pipeline a `StartUp` configured, without a running hub.
 * Built by {@link buildEventHubWorkerHost}; push an event through it with
 * {@link EventHubWorkerBenzeneTestHost.handleAsync} (build one from a `messageBuilder(...)` via
 * `asEventHubBenzeneMessage(...)`).
 *
 * IDIOM MAP: C# `IDisposable.Dispose` → `dispose()`; `HandleAsync` → `handleAsync` (keeping the `Async`
 * suffix). C# returns `Task<IBenzeneResult?>`; the port returns the consumer application's recorded
 * result type, `IMessageResult | undefined` (the same `IBenzeneResult`→`IMessageResult` mapping the
 * `@benzenejs/azure-event-hub` consumer already uses).
 */
export class EventHubWorkerBenzeneTestHost {
  constructor(
    private readonly application: EventHubConsumerApplication,
    private readonly serviceResolverFactory: IServiceResolverFactory,
  ) {}

  /**
   * Runs an event through the pipeline exactly as `BenzeneEventHubWorker` would, returning the handler's
   * recorded result (or `undefined` if nothing set one).
   * @param eventData The event to handle (typically built by `asEventHubBenzeneMessage(...)`).
   * @returns The handler's result, or `undefined`.
   */
  handleAsync(eventData: ReceivedEventData): Promise<IMessageResult | undefined> {
    return this.application.handleAsync(eventData, this.serviceResolverFactory);
  }

  /** Disposes the resolver factory (and the service provider it owns). Port of C# `Dispose`. */
  dispose(): void {
    this.serviceResolverFactory.dispose();
  }
}

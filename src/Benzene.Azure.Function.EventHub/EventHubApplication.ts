/** Port of Benzene.Azure.Function.EventHub.Function.EventHubApplication. */
import { ReceivedEventData } from '@azure/event-hubs';
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzenejs/abstractions';
import { IMiddlewareApplication, IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { EntryPointMiddlewareApplication } from '@benzenejs/core-middleware';
import { TransportMiddlewarePipeline, TransportNames } from '@benzenejs/core-message-handlers';
import { EventHubContext } from './EventHubContext';
import { EventHubMessageProcessingException } from './EventHubMessageProcessingException';
import { EventHubOptions } from './EventHubOptions';

/**
 * The entry point application for an Event Hub-triggered Azure Function. Maps each event in the triggered
 * batch to an `EventHubContext` and runs them all through the middleware pipeline, tagging the transport
 * as `"event-hub"` for the duration. Exception/failure-status behavior is configurable via
 * `EventHubOptions`, mirroring `@benzenejs/azure-function-event-grid` and
 * `@benzenejs/azure-function-queue-storage`.
 *
 * FAITHFUL to the C#: `EventHubApplication : EntryPointMiddlewareApplication<EventData[]>` wrapping an
 * `EventHubBatchApplication` (which in C# plugs into the shared `AzureFunctionBatchApplicationBase`
 * escalate/log skeleton; this port keeps the per-adapter inline shape the TS ServiceBus/Kafka trigger
 * packages already use). The batch type is the Node received type `ReceivedEventData[]`.
 * `AzureFunctionApp` dispatches to it via the fire-and-forget `handleAsync` path.
 */
export class EventHubApplication extends EntryPointMiddlewareApplication<ReceivedEventData[]> {
  /**
   * @param pipeline The built Event Hub middleware pipeline to run each event through.
   * @param serviceResolverFactory The service resolver factory used to process each batch.
   * @param options Configures how a handler's exceptions and failure results are handled. Defaults to a
   *   new `EventHubOptions` (safe-by-default on the failure-result axis: `raiseOnFailureStatus` on,
   *   `catchExceptions` off).
   */
  constructor(
    pipeline: IMiddlewarePipeline<EventHubContext>,
    serviceResolverFactory: IServiceResolverFactory,
    options?: EventHubOptions,
  ) {
    super(new EventHubBatchApplication(pipeline, options), serviceResolverFactory);
  }
}

/**
 * Runs every event in an Event Hub triggered batch through the middleware pipeline concurrently, each
 * in its own service scope, applying `EventHubOptions` to decide whether an event's exception or
 * failure result is contained (logged, so its siblings still complete) or left to cascade and fail the
 * whole Functions invocation (so the Event Hubs trigger re-delivers the entire batch). Mirrors
 * `EventGridBatchApplication` / `QueueStorageBatchApplication` on the failure-result axis and the Azure
 * Kafka trigger on the null-outcome carve-out.
 *
 * EXCEPTION SEMANTICS: C#'s `catch (Exception ex) when (_options.CatchExceptions)` is a conditional
 * catch — the exception is only caught when `catchExceptions` is true, otherwise it cascades.
 * TypeScript has no exception filters, so the port catches then re-throws when `catchExceptions` is
 * false, which is behaviorally identical.
 */
export class EventHubBatchApplication implements IMiddlewareApplication<ReceivedEventData[]> {
  private readonly pipeline: IMiddlewarePipeline<EventHubContext>;
  private readonly options: EventHubOptions;

  constructor(pipeline: IMiddlewarePipeline<EventHubContext>, options?: EventHubOptions) {
    this.pipeline = new TransportMiddlewarePipeline<EventHubContext>(TransportNames.EventHub, pipeline);
    this.options = options ?? new EventHubOptions();
  }

  async handleAsync(
    event: ReceivedEventData[],
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    const tasks = event
      .map((eventData) => EventHubContext.createInstance(eventData))
      .map(async (context) => {
        try {
          const scope = serviceResolverFactory.createScope();
          try {
            await this.pipeline.handleAsync(context, scope);
          } finally {
            if (scope.disposeAsync) {
              await scope.disposeAsync();
            } else {
              scope.dispose();
            }
          }

          // CARVE-OUT — do not "fix" to `!== true` without reading benzene-dotnet's
          // work/settlement-consistency-fix-plan.md (row 17). Event Hubs has no per-record dead-letter
          // path: the trigger checkpoints (or replays) the whole batch, there is no per-event redrive.
          // Escalating an unrouted event (null/unestablished outcome) the way the queue-shaped
          // transports do would mean an unroutable event replays the entire batch forever — a worse
          // failure mode than the one this policy exists to fix. So only an explicit failure result
          // escalates; a null outcome stays acked, matching the self-hosted Event Hub worker and the
          // Kafka trigger/worker adapters.
          if (this.options.raiseOnFailureStatus && context.messageResult?.isSuccessful === false) {
            throw new EventHubMessageProcessingException(String(context.eventData.sequenceNumber));
          }
        } catch (ex) {
          if (!this.options.catchExceptions) {
            throw ex;
          }

          const loggingScope = serviceResolverFactory.createScope();
          try {
            const logger =
              loggingScope.tryGetService(ILoggerFactory)?.createLogger('EventHubApplication') ??
              NullLogger.instance;
            logger.logError(
              ex,
              `Processing Event Hub event ${String(context.eventData.sequenceNumber)} failed`,
            );
          } finally {
            if (loggingScope.disposeAsync) {
              await loggingScope.disposeAsync();
            } else {
              loggingScope.dispose();
            }
          }
        }
      });

    await Promise.all(tasks);
  }
}

/** Port of Benzene.Azure.Function.EventGrid.EventGridApplication. */
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzenejs/abstractions';
import { IMiddlewareApplication, IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { BoundedFanOut, EntryPointMiddlewareApplication } from '@benzenejs/core-middleware';
import { TransportMiddlewarePipeline, TransportNames } from '@benzenejs/core-message-handlers';
import { EventGridContext } from './EventGridContext';
import { EventGridMessageProcessingException } from './EventGridMessageProcessingException';
import { EventGridOptions } from './EventGridOptions';
import { EventGridTriggerEvent } from './EventGridTriggerEvent';

/**
 * The entry point application for an Event Grid-triggered Azure Function. Maps each event to an
 * `EventGridContext` and runs it through the middleware pipeline, tagging the transport as
 * `"event-grid"` for the duration. Exception/failure-status behavior is configurable via
 * `EventGridOptions`, mirroring the C# `EventGridApplication` (and `KafkaApplication`).
 *
 * Reuses the already-ported `EntryPointMiddlewareApplication<EventGridTriggerEvent[]>` (arity-1,
 * fire-and-forget), exactly as C#'s `EventGridApplication : EntryPointMiddlewareApplication<
 * EventGridTriggerEvent[]>`. The array shape covers batched ("many"-cardinality) triggers and tests.
 * `AzureFunctionApp` dispatches to it via the fire-and-forget `handleAsync` path.
 */
export class EventGridApplication extends EntryPointMiddlewareApplication<EventGridTriggerEvent[]> {
  /**
   * @param pipeline The built Event Grid middleware pipeline to run each event through.
   * @param serviceResolverFactory The service resolver factory used to process each invocation.
   * @param options Configures how a handler's exceptions and failure results are handled, and the batch
   *   fan-out concurrency. Defaults to a new `EventGridOptions` (`catchExceptions` off,
   *   `raiseOnFailureStatus` on) if omitted.
   */
  constructor(
    pipeline: IMiddlewarePipeline<EventGridContext>,
    serviceResolverFactory: IServiceResolverFactory,
    options?: EventGridOptions,
  ) {
    super(new EventGridBatchApplication(pipeline, options), serviceResolverFactory);
  }
}

/**
 * Runs every event in an Event Grid delivery through the middleware pipeline concurrently, each in its
 * own service scope, applying `EventGridOptions` to decide whether an event's exception or failure
 * result is contained (logged) or left to cascade and fail the invocation (so Event Grid's
 * retry/dead-letter policy engages).
 *
 * Reuses the already-ported `IMiddlewareApplication<EventGridTriggerEvent[]>` (the fire-and-forget
 * arity-1 variant), matching C#'s `EventGridBatchApplication : IMiddlewareApplication<
 * EventGridTriggerEvent[]>`. Per-event SCOPE + TRANSPORT: it maps the event array to one
 * `EventGridContext` per event and runs each in ITS OWN scope (`createScope()` / try-finally
 * `dispose()`, the port of C# `using`), fanned out via the already-ported `BoundedFanOut.whenAllAsync`
 * (C# `BoundedFanOut.WhenAllAsync`) so `maxDegreeOfParallelism` optionally caps concurrency. The
 * transport is set to `"event-grid"` inside each scope by wrapping the pipeline in the already-ported
 * `TransportMiddlewarePipeline`, exactly what the C# constructor does.
 *
 * EXCEPTION SEMANTICS: C#'s `catch (Exception ex) when (_options.CatchExceptions)` is a conditional
 * catch — the exception is only caught when `catchExceptions` is true, otherwise it cascades.
 * TypeScript has no exception filters, so the port catches then re-throws when `catchExceptions` is
 * false, which is behaviorally identical.
 */
export class EventGridBatchApplication implements IMiddlewareApplication<EventGridTriggerEvent[]> {
  private readonly pipeline: IMiddlewarePipeline<EventGridContext>;
  private readonly options: EventGridOptions;

  constructor(pipeline: IMiddlewarePipeline<EventGridContext>, options?: EventGridOptions) {
    this.pipeline = new TransportMiddlewarePipeline<EventGridContext>(
      TransportNames.EventGrid,
      pipeline,
    );
    this.options = options ?? new EventGridOptions();
  }

  async handleAsync(
    event: EventGridTriggerEvent[],
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    const contexts = event.map((gridEvent) => new EventGridContext(gridEvent));
    await BoundedFanOut.whenAllAsync(
      contexts,
      async (context) => {
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

          if (this.options.raiseOnFailureStatus && context.messageResult?.isSuccessful === false) {
            throw new EventGridMessageProcessingException(
              context.event.id ?? context.event.eventType ?? 'unknown',
            );
          }
        } catch (ex) {
          if (!this.options.catchExceptions) {
            throw ex;
          }

          const loggingScope = serviceResolverFactory.createScope();
          try {
            const logger =
              loggingScope.tryGetService(ILoggerFactory)?.createLogger('EventGridApplication') ??
              NullLogger.instance;
            logger.logError(ex, `Processing Event Grid event ${context.event.id ?? '<none>'} failed`);
          } finally {
            if (loggingScope.disposeAsync) {
              await loggingScope.disposeAsync();
            } else {
              loggingScope.dispose();
            }
          }
        }
      },
      this.options.maxDegreeOfParallelism,
    );
  }
}

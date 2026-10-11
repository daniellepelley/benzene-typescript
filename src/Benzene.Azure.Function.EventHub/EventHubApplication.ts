/** Port of Benzene.Azure.Function.EventHub.Function.EventHubApplication. */
import { ReceivedEventData } from '@azure/event-hubs';
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzenejs/abstractions';
import { IMiddlewareApplication, IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { BoundedFanOut, EntryPointMiddlewareApplication } from '@benzenejs/core-middleware';
import { isSettledAsFailure, TransportMiddlewarePipeline, TransportNames } from '@benzenejs/core-message-handlers';
import { EventHubContext } from './EventHubContext';
import { EventHubMessageProcessingException } from './EventHubMessageProcessingException';
import { EventHubOptions } from './EventHubOptions';

/**
 * The Event Hub trigger's entry point: fans the triggered batch out across the pipeline (one context and
 * scope per event, transport tagged `"eventhub"`) and settles it per `EventHubOptions`.
 */
export class EventHubApplication extends EntryPointMiddlewareApplication<ReceivedEventData[]> {
  constructor(
    pipeline: IMiddlewarePipeline<EventHubContext>,
    serviceResolverFactory: IServiceResolverFactory,
    options?: EventHubOptions,
  ) {
    super(new EventHubBatchApplication(pipeline, options), serviceResolverFactory);
  }
}

/** Port of .NET's `EventHubBatchApplication`: the fan-out/settle/escalate step of `EventHubApplication`. */
export class EventHubBatchApplication implements IMiddlewareApplication<ReceivedEventData[]> {
  private readonly pipeline: IMiddlewarePipeline<EventHubContext>;
  private readonly options: EventHubOptions;

  constructor(pipeline: IMiddlewarePipeline<EventHubContext>, options?: EventHubOptions) {
    this.pipeline = new TransportMiddlewarePipeline<EventHubContext>(TransportNames.EventHub, pipeline);
    this.options = options ?? new EventHubOptions();
  }

  async handleAsync(event: ReceivedEventData[], serviceResolverFactory: IServiceResolverFactory): Promise<void> {
    const contexts = event.map((e) => EventHubContext.createInstance(e));
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

          // A failure result is redelivered; a missing result is acknowledged (the stream carve-out — see
          // EventHubOptions); an unmatched topic follows ignoreUnmatchedTopics.
          if (
            !this.options.atMostOnce &&
            this.options.raiseOnFailureStatus &&
            isSettledAsFailure(context.messageResult, {
              ignoreUnmatchedTopics: this.options.ignoreUnmatchedTopics,
              missingResult: 'acknowledge',
            })
          ) {
            throw new EventHubMessageProcessingException(context.eventData.sequenceNumber);
          }
        } catch (ex) {
          if (!this.options.catchExceptions && !this.options.atMostOnce) {
            throw ex;
          }

          const loggingScope = serviceResolverFactory.createScope();
          try {
            const logger =
              loggingScope.tryGetService(ILoggerFactory)?.createLogger('EventHubApplication') ?? NullLogger.instance;
            logger.logError(ex, `Processing Event Hub event ${context.eventData.sequenceNumber} failed`);
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

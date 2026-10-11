/** Port of Benzene.Azure.Function.Timer.TimerApplication. */
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzenejs/abstractions';
import { IMiddlewareApplication, IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { EntryPointMiddlewareApplication } from '@benzenejs/core-middleware';
import { isSettledAsFailure, TransportMiddlewarePipeline, TransportNames } from '@benzenejs/core-message-handlers';
import { TimerContext } from './TimerContext';
import { TimerMessageProcessingException } from './TimerMessageProcessingException';
import { TimerOptions } from './TimerOptions';
import { TimerTriggerInfo } from './TimerTriggerInfo';

/**
 * The Timer trigger's entry point: runs each tick through the pipeline (transport tagged `"timer"`) and
 * settles it per `TimerOptions`.
 */
export class TimerApplication extends EntryPointMiddlewareApplication<TimerTriggerInfo> {
  /**
   * @param pipeline The built timer middleware pipeline to run each tick through.
   * @param serviceResolverFactory The service resolver factory used to process each invocation.
   * @param options How the tick is settled. Defaults to a new `TimerOptions`.
   */
  constructor(
    pipeline: IMiddlewarePipeline<TimerContext>,
    serviceResolverFactory: IServiceResolverFactory,
    options?: TimerOptions,
  ) {
    super(new TimerTickApplication(pipeline, options), serviceResolverFactory);
  }
}

/** Runs one tick in its own scope and escalates a failure result per `TimerOptions`. */
class TimerTickApplication implements IMiddlewareApplication<TimerTriggerInfo> {
  private readonly pipeline: IMiddlewarePipeline<TimerContext>;
  private readonly options: TimerOptions;

  constructor(pipeline: IMiddlewarePipeline<TimerContext>, options?: TimerOptions) {
    this.pipeline = new TransportMiddlewarePipeline<TimerContext>(TransportNames.Timer, pipeline);
    this.options = options ?? new TimerOptions();
  }

  async handleAsync(timer: TimerTriggerInfo, serviceResolverFactory: IServiceResolverFactory): Promise<void> {
    const context = new TimerContext(timer);
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

      // Only a recorded failure escalates; a tick with no result (useTick) is not a failure — see TimerOptions.
      if (
        !this.options.atMostOnce &&
        this.options.raiseOnFailureStatus &&
        isSettledAsFailure(context.messageResult, {
          ignoreUnmatchedTopics: this.options.ignoreUnmatchedTopics,
          missingResult: 'acknowledge',
        })
      ) {
        throw new TimerMessageProcessingException();
      }
    } catch (ex) {
      if (!this.options.catchExceptions && !this.options.atMostOnce) {
        throw ex;
      }
      const loggingScope = serviceResolverFactory.createScope();
      try {
        const logger =
          loggingScope.tryGetService(ILoggerFactory)?.createLogger('TimerApplication') ?? NullLogger.instance;
        logger.logError(ex, 'Processing the timer tick failed');
      } finally {
        if (loggingScope.disposeAsync) {
          await loggingScope.disposeAsync();
        } else {
          loggingScope.dispose();
        }
      }
    }
  }
}

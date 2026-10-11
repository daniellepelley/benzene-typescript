/** Port of Benzene.Aws.Lambda.EventBridge.EventBridgeApplication. */
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzenejs/abstractions';
import { IMiddlewareApplication, IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { isSettledAsFailure, TransportMiddlewarePipeline, TransportNames } from '@benzenejs/core-message-handlers';
import { EventBridgeEvent } from 'aws-lambda';
import { EventBridgeContext } from './EventBridgeContext';
import { EventBridgeMessageProcessingException } from './EventBridgeMessageProcessingException';
import { EventBridgeOptions } from './EventBridgeOptions';

/**
 * Runs one EventBridge event through the `EventBridgeContext` middleware pipeline — a SINGLE-context
 * application (one pipeline invocation + one DI scope per event), since EventBridge invokes a Lambda target
 * with exactly one event, not a batch — and settles it per `EventBridgeOptions`.
 *
 * Settlement (transport-bindings §1, obligation 8): a one-shot binding, so a failure result, a missing
 * result and an uncaught exception fail the invocation (EventBridge retries it) unless `atMostOnce`; an
 * unmatched `detail-type` is a failure unless `ignoreUnmatchedTopics`.
 *
 * C# derives from `SingleContextEscalatingApplicationBase` (the escalate/catch/log skeleton shared with SNS
 * and S3); the port has no such base and writes the same steps inline, as `SnsApplication` does.
 */
export class EventBridgeApplication implements IMiddlewareApplication<EventBridgeEvent<string, unknown>> {
  private readonly pipeline: IMiddlewarePipeline<EventBridgeContext>;
  private readonly options: EventBridgeOptions;

  constructor(pipeline: IMiddlewarePipeline<EventBridgeContext>, options?: EventBridgeOptions) {
    this.pipeline = new TransportMiddlewarePipeline<EventBridgeContext>(TransportNames.EventBridge, pipeline);
    this.options = options ?? new EventBridgeOptions();
  }

  async handleAsync(
    event: EventBridgeEvent<string, unknown>,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    const context = new EventBridgeContext(event);
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

      if (
        !this.options.atMostOnce &&
        this.options.raiseOnFailureStatus &&
        isSettledAsFailure(context.messageResult, { ignoreUnmatchedTopics: this.options.ignoreUnmatchedTopics })
      ) {
        throw new EventBridgeMessageProcessingException(event.id, event['detail-type']);
      }
    } catch (ex) {
      if (!this.options.catchExceptions && !this.options.atMostOnce) {
        throw ex;
      }

      const loggingScope = serviceResolverFactory.createScope();
      try {
        const logger =
          loggingScope.tryGetService(ILoggerFactory)?.createLogger('EventBridgeApplication') ?? NullLogger.instance;
        logger.logError(ex, `Processing EventBridge event ${event.id} failed`);
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

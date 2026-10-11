/** Port of Benzene.Aws.Lambda.S3.S3Application. */
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzenejs/abstractions';
import { IMiddlewareApplication, IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { isSettledAsFailure, TransportMiddlewarePipeline, TransportNames } from '@benzenejs/core-message-handlers';
import { S3Event } from 'aws-lambda';
import { S3MessageProcessingException } from './S3MessageProcessingException';
import { S3Options } from './S3Options';
import { S3RecordContext } from './S3RecordContext';

/**
 * Processes an S3 event notification batch by mapping each record to an `S3RecordContext` and running them
 * all through the middleware pipeline concurrently (each in its own DI scope), tagging the transport as
 * `"s3"` for the duration, then settling each record per `S3Options`.
 *
 * Settlement (transport-bindings §1, obligation 8): a one-shot binding, so a failure result, a missing
 * result and an uncaught exception fail the invocation (Lambda retries the event) unless `atMostOnce`; an
 * unmatched event name is a failure unless `ignoreUnmatchedTopics`.
 *
 * C# derives from `SingleContextEscalatingApplicationBase`; the port writes the same escalate/catch/log
 * steps inline, as `SnsApplication` does. `event.Records` stays PascalCase in `@types/aws-lambda`.
 */
export class S3Application implements IMiddlewareApplication<S3Event> {
  private readonly pipeline: IMiddlewarePipeline<S3RecordContext>;
  private readonly options: S3Options;

  constructor(pipeline: IMiddlewarePipeline<S3RecordContext>, options?: S3Options) {
    this.pipeline = new TransportMiddlewarePipeline<S3RecordContext>(TransportNames.S3, pipeline);
    this.options = options ?? new S3Options();
  }

  async handleAsync(event: S3Event, serviceResolverFactory: IServiceResolverFactory): Promise<void> {
    const tasks = event.Records.map((record) => S3RecordContext.createInstance(event, record)).map(
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

          if (
            !this.options.atMostOnce &&
            this.options.raiseOnFailureStatus &&
            isSettledAsFailure(context.messageResult, { ignoreUnmatchedTopics: this.options.ignoreUnmatchedTopics })
          ) {
            throw new S3MessageProcessingException(
              context.s3EventNotificationRecord.s3?.object?.key,
              context.s3EventNotificationRecord.eventName,
            );
          }
        } catch (ex) {
          if (!this.options.catchExceptions && !this.options.atMostOnce) {
            throw ex;
          }

          const loggingScope = serviceResolverFactory.createScope();
          try {
            const logger =
              loggingScope.tryGetService(ILoggerFactory)?.createLogger('S3Application') ?? NullLogger.instance;
            logger.logError(ex, `Processing S3 record ${context.s3EventNotificationRecord.s3?.object?.key ?? ''} failed`);
          } finally {
            if (loggingScope.disposeAsync) {
              await loggingScope.disposeAsync();
            } else {
              loggingScope.dispose();
            }
          }
        }
      },
    );

    await Promise.all(tasks);
  }
}

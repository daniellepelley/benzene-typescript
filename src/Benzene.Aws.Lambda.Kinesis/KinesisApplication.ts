/** Port of Benzene.Aws.Lambda.Kinesis.KinesisApplication (per-record adaptation; see KinesisOptions). */
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzenejs/abstractions';
import { IMiddlewareApplication, IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { isSettledAsFailure, TransportMiddlewarePipeline, TransportNames } from '@benzenejs/core-message-handlers';
import { KinesisStreamEvent } from 'aws-lambda';
import { KinesisMessageContext } from './KinesisMessageContext';
import { KinesisMessageProcessingException } from './KinesisMessageProcessingException';
import { KinesisOptions } from './KinesisOptions';

/**
 * Processes a Kinesis batch by mapping each record to a `KinesisMessageContext` and running them through
 * the pipeline concurrently, each in its own DI scope, tagging the transport `"kinesis"`; then settles the
 * batch per `KinesisOptions` — the unit of settlement is the invocation: any record that must be
 * redelivered fails it, so Lambda retries the whole batch.
 */
export class KinesisApplication implements IMiddlewareApplication<KinesisStreamEvent> {
  private readonly pipeline: IMiddlewarePipeline<KinesisMessageContext>;
  private readonly options: KinesisOptions;

  constructor(pipeline: IMiddlewarePipeline<KinesisMessageContext>, options?: KinesisOptions) {
    this.pipeline = new TransportMiddlewarePipeline<KinesisMessageContext>(TransportNames.Kinesis, pipeline);
    this.options = options ?? new KinesisOptions();
  }

  async handleAsync(
    event: KinesisStreamEvent,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    const records = event.Records ?? [];
    const failed: string[] = [];

    const tasks = records
      .map((record) => KinesisMessageContext.createInstance(event, record))
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
        } catch (ex) {
          if (!this.options.catchExceptions && !this.options.atMostOnce) {
            throw ex;
          }
          await logFailure(serviceResolverFactory, ex, context.record.kinesis.sequenceNumber);
          return;
        }

        // A failure result is redelivered; a missing result is acknowledged (the stream carve-out, see
        // KinesisOptions); an unmatched topic follows ignoreUnmatchedTopics.
        if (
          !this.options.atMostOnce &&
          this.options.raiseOnFailureStatus &&
          isSettledAsFailure(context.messageResult, {
            ignoreUnmatchedTopics: this.options.ignoreUnmatchedTopics,
            missingResult: 'acknowledge',
          })
        ) {
          failed.push(context.record.kinesis.sequenceNumber);
        }
      });

    await Promise.all(tasks);

    if (failed.length > 0) {
      throw new KinesisMessageProcessingException(failed);
    }
  }
}

async function logFailure(serviceResolverFactory: IServiceResolverFactory, ex: unknown, sequenceNumber: string): Promise<void> {
  const loggingScope = serviceResolverFactory.createScope();
  try {
    const logger =
      loggingScope.tryGetService(ILoggerFactory)?.createLogger('KinesisApplication') ?? NullLogger.instance;
    logger.logError(ex, `Processing Kinesis record ${sequenceNumber} failed`);
  } finally {
    if (loggingScope.disposeAsync) {
      await loggingScope.disposeAsync();
    } else {
      loggingScope.dispose();
    }
  }
}

import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzene/abstractions';
import { ISetCurrentTransport } from '@benzene/abstractions-message-handlers';
import { IMiddlewareApplicationWithResult, IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { SqsBatchFailureMode } from './SqsBatchFailureMode';
import { SqsBatchProcessingException } from './SqsBatchProcessingException';
import { SqsMessageContext } from './SqsMessageContext';
import { SqsOptions } from './SqsOptions';

/**
 * Port of Benzene.Aws.Lambda.Sqs.SqsApplication.
 *
 * Processes an SQS batch event by running each record through the middleware pipeline concurrently,
 * reporting per-record failures back to SQS for partial batch retry.
 *
 * C# `IMiddlewareApplication<SQSEvent, SQSBatchResponse>` (the arity-2, result-returning variant)
 * maps to `IMiddlewareApplicationWithResult<SQSEvent, SQSBatchResponse>` per the `WithResult` suffix
 * rule. Batching/scopes/transport, faithful to .NET:
 *   - iterates `event.Records` (this property stays PascalCase in `@types/aws-lambda`), building one
 *     `SqsMessageContext` per record;
 *   - runs each record's pipeline in ITS OWN service scope (`createScope()` / try-finally
 *     `dispose()`, the port of C# `using`), concurrently via `Promise.all` (the port of
 *     `Task.WhenAll`);
 *   - inside each scope resolves `ISetCurrentTransport` and calls `setTransport('sqs')` before
 *     running the pipeline, so downstream middleware knows the active transport;
 *   - collects failures into `batchItemFailures` keyed by `messageId` — a record fails if its handler
 *     reported an unsuccessful result (`isSuccessful === false`) or processing it threw;
 *   - honors `SqsBatchFailureMode`: in `FailWholeBatch` a non-empty failure list throws
 *     `SqsBatchProcessingException` (failing the whole invocation) instead of returning.
 * `ILogger<SqsApplication>` maps to an `ILoggerFactory`-created logger, falling back to `NullLogger`.
 */
export class SqsApplication implements IMiddlewareApplicationWithResult<SQSEvent, SQSBatchResponse> {
  private readonly options: SqsOptions;

  constructor(
    private readonly pipeline: IMiddlewarePipeline<SqsMessageContext>,
    options?: SqsOptions,
  ) {
    this.options = options ?? new SqsOptions();
  }

  async handleAsync(
    event: SQSEvent,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<SQSBatchResponse> {
    const batchItemFailures: SQSBatchItemFailure[] = [];

    const tasks = event.Records.map((record) => SqsMessageContext.createInstance(event, record)).map(
      async (context) => {
        try {
          const scope = serviceResolverFactory.createScope();
          try {
            const setCurrentTransport = scope.getService(ISetCurrentTransport);
            setCurrentTransport.setTransport('sqs');
            await this.pipeline.handleAsync(context, scope);
          } finally {
            scope.dispose();
          }

          if (context.isSuccessful === false) {
            batchItemFailures.push({ itemIdentifier: context.sqsMessage.messageId });
          }
        } catch (ex) {
          const loggingScope = serviceResolverFactory.createScope();
          try {
            const logger =
              loggingScope.tryGetService(ILoggerFactory)?.createLogger('SqsApplication') ??
              NullLogger.instance;
            logger.logError(ex, `Processing SQS message ${context.sqsMessage.messageId} failed`);
          } finally {
            loggingScope.dispose();
          }

          batchItemFailures.push({ itemIdentifier: context.sqsMessage.messageId });
        }
      },
    );

    await Promise.all(tasks);

    if (
      batchItemFailures.length > 0 &&
      this.options.batchFailureMode === SqsBatchFailureMode.FailWholeBatch
    ) {
      throw new SqsBatchProcessingException(batchItemFailures.map((f) => f.itemIdentifier));
    }

    return { batchItemFailures };
  }
}

/** Port of Benzene.Aws.Lambda.DynamoDb.DynamoDbApplication. */
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzenejs/abstractions';
import { ISetCurrentTransport, TransportNames } from '@benzenejs/abstractions-message-handlers';
import { IMiddlewareApplicationWithResult, IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { DynamoDBBatchResponse, DynamoDBStreamEvent } from 'aws-lambda';
import { DynamoDbRecordContext } from './DynamoDbRecordContext';

/**
 * Processes a DynamoDB Streams batch by running each record through the middleware pipeline
 * SEQUENTIALLY, in shard order, STOPPING AT THE FIRST FAILURE (plan decision DS5) — deliberately unlike
 * `SqsApplication`'s concurrent fan-out. Stream records are ordered change-data-capture: processing them
 * concurrently, or continuing past a failure, breaks the per-key ordering the stream guarantees. The first
 * failed record's sequence number is reported as the batch item failure, so Lambda checkpoints there and
 * redelivers from that record.
 *
 * C# `IMiddlewareApplication<DynamoDbEvent, DynamoDbBatchResponse>` (the arity-2, result-returning
 * variant) maps to `IMiddlewareApplicationWithResult<DynamoDBStreamEvent, DynamoDBBatchResponse>` per the
 * `WithResult` suffix rule (with `@types/aws-lambda`'s `DynamoDBBatchResponse` replacing the bespoke C#
 * response model). Per-record SCOPE + TRANSPORT, faithful to .NET: each record runs in ITS OWN scope
 * (`createScope()` / try-finally `dispose()`, the port of C# `using`), and inside each scope
 * `ISetCurrentTransport.setTransport('dynamodb')` is called before running the pipeline. A record fails if
 * its handler did not report a successful result (`isSuccessful !== true` — an unrouted/unestablished
 * outcome is retained for redelivery too) or processing it threw; on the
 * first failure it returns that record's `SequenceNumber` (or `eventID` fallback) and leaves the rest
 * unprocessed. `ILogger<DynamoDbApplication>` maps to an `ILoggerFactory`-created logger, falling back to
 * `NullLogger`.
 */
export class DynamoDbApplication
  implements IMiddlewareApplicationWithResult<DynamoDBStreamEvent, DynamoDBBatchResponse>
{
  constructor(private readonly pipeline: IMiddlewarePipeline<DynamoDbRecordContext>) {}

  async handleAsync(
    event: DynamoDBStreamEvent,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<DynamoDBBatchResponse> {
    for (const record of event.Records) {
      const context = DynamoDbRecordContext.createInstance(event, record);
      try {
        const scope = serviceResolverFactory.createScope();
        try {
          const setCurrentTransport = scope.getService(ISetCurrentTransport);
          setCurrentTransport.setTransport(TransportNames.DynamoDb);
          await this.pipeline.handleAsync(context, scope);
        } finally {
          if (scope.disposeAsync) {
            await scope.disposeAsync();
          } else {
            scope.dispose();
          }
        }
      } catch (ex) {
        const loggingScope = serviceResolverFactory.createScope();
        try {
          const logger =
            loggingScope.tryGetService(ILoggerFactory)?.createLogger('DynamoDbApplication') ??
            NullLogger.instance;
          logger.logError(
            ex,
            `Processing DynamoDB stream record ${record.dynamodb?.SequenceNumber} failed`,
          );
        } finally {
          if (loggingScope.disposeAsync) {
            await loggingScope.disposeAsync();
          } else {
            loggingScope.dispose();
          }
        }

        context.isSuccessful = false;
      }

      // A null/unestablished outcome (isSuccessful never set — typically an unrouted record: no
      // handler matched the topic) stops the batch and is reported for redelivery, not checkpointed
      // past. The stream's retention + `ReportBatchItemFailures` redrive is the backstop — matching
      // .NET's `context.MessageResult?.IsSuccessful != true` (work/settlement-consistency-fix-plan.md
      // row 11 in benzene-dotnet).
      if (context.isSuccessful !== true) {
        return {
          batchItemFailures: [
            { itemIdentifier: record.dynamodb?.SequenceNumber ?? record.eventID ?? '' },
          ],
        };
      }
    }

    return { batchItemFailures: [] };
  }
}

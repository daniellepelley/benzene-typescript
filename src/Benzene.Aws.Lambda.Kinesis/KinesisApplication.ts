/** Port of Benzene.Aws.Lambda.Kinesis.KinesisStreamApplication (adapted — see the ADAPTATION note). */
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzenejs/abstractions';
import {
  IMiddlewareApplicationWithResult,
  IMiddlewarePipeline,
} from '@benzenejs/abstractions-middleware';
import { TransportMiddlewarePipeline, TransportNames } from '@benzenejs/core-message-handlers';
import { KinesisStreamBatchResponse, KinesisStreamEvent, KinesisStreamRecord } from 'aws-lambda';
import { KinesisMessageContext } from './KinesisMessageContext';
import { KinesisStreamCheckpointer } from './KinesisStreamCheckpointer';

/**
 * Processes a Kinesis batch with the .NET checkpoint engine's semantics, adapted to this port's
 * per-record routing model: records are grouped by partition key (each group processed SEQUENTIALLY
 * in shard order, STOPPING AT ITS FIRST FAILURE; groups run concurrently — the `PartitionBy` shape
 * the C# package's own docs recommend for restoring per-key ordering), each successfully-handled
 * record is confirmed on a `KinesisStreamCheckpointer`, and the response names the **contiguous-
 * prefix watermark** — the first unconfirmed record's sequence number — as the single
 * `batchItemFailures` resume point for triggers with `ReportBatchItemFailures` configured (AWS
 * reads only the FIRST reported failure for a Kinesis mapping and retries every record from that
 * sequence number to the end of the batch).
 *
 * A record fails if processing it threw, its handler returned a failure result, or its outcome was
 * never established (`isSuccessful !== true` — typically an unrouted record: no handler matched the
 * topic); the failure stops that partition key's group and is never checkpointed past, so it is
 * reported for redelivery rather than silently skipped. A later-index record another partition's
 * group already confirmed is re-reported alongside it — safe over-retry (at-least-once; keep
 * handlers idempotent), never the silent skip a max-index watermark risks (.NET R17 #273; see
 * `KinesisStreamCheckpointer`).
 *
 * STREAMING -> PER-RECORD ADAPTATION: the C# `KinesisStreamApplication` runs the whole batch as ONE
 * `StreamContext<KinesisEventRecord>` through the (unported) streaming engine, and the handler owns
 * the checkpointer. This port routes each record to a `@message` handler instead (see
 * `KinesisMessageContext`), so the application owns checkpointing: a successful record is confirmed
 * automatically (the .NET `AutoCheckpointOnSuccess` default, with nothing to toggle) and a
 * per-record throw is caught and logged with the resume point still returned (the .NET
 * `CatchExceptions` default — the resume point IS the correct failure signal for Kinesis's
 * shard-ordered retry contract, so nothing is gained by cascading). `KinesisStreamOptions` is
 * therefore not ported — both knobs configure handler-owned checkpointing that doesn't exist here.
 *
 * C# `StreamMiddlewareApplication<KinesisEvent, KinesisEventRecord, KinesisBatchResponse>` maps to
 * `IMiddlewareApplicationWithResult<KinesisStreamEvent, KinesisStreamBatchResponse>` (the
 * `WithResult` rule, with `@types/aws-lambda`'s response model replacing the bespoke C# one). Each
 * record runs in ITS OWN scope (`createScope()` / try-finally `dispose()`), and the transport is
 * tagged via the ported `TransportMiddlewarePipeline("kinesis", pipeline)` exactly as the C#
 * constructor wraps its pipeline.
 */
export class KinesisApplication
  implements IMiddlewareApplicationWithResult<KinesisStreamEvent, KinesisStreamBatchResponse>
{
  private readonly pipeline: IMiddlewarePipeline<KinesisMessageContext>;

  constructor(pipeline: IMiddlewarePipeline<KinesisMessageContext>) {
    this.pipeline = new TransportMiddlewarePipeline<KinesisMessageContext>(TransportNames.Kinesis, pipeline);
  }

  async handleAsync(
    event: KinesisStreamEvent,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<KinesisStreamBatchResponse> {
    const records = event.Records ?? [];
    const checkpointer = new KinesisStreamCheckpointer(records);

    // Group by partition key, preserving the original batch (shard) order within each group.
    const groups = new Map<string, KinesisStreamRecord[]>();
    for (const record of records) {
      const key = record.kinesis?.partitionKey ?? '';
      const group = groups.get(key);
      if (group !== undefined) {
        group.push(record);
      } else {
        groups.set(key, [record]);
      }
    }

    await Promise.all(
      [...groups.values()].map((group) =>
        this.processGroupAsync(event, group, checkpointer, serviceResolverFactory),
      ),
    );

    const resumePoint = checkpointer.firstUncheckpointedSequenceNumber;
    return {
      batchItemFailures: resumePoint === undefined ? [] : [{ itemIdentifier: resumePoint }],
    };
  }

  /**
   * Processes one partition key's records sequentially in shard order, confirming each success on
   * the shared checkpointer and stopping at the group's first failure (which stays unconfirmed, so
   * the watermark never advances past it).
   */
  private async processGroupAsync(
    event: KinesisStreamEvent,
    group: readonly KinesisStreamRecord[],
    checkpointer: KinesisStreamCheckpointer,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    for (const record of group) {
      const context = KinesisMessageContext.createInstance(event, record);
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
        const loggingScope = serviceResolverFactory.createScope();
        try {
          const logger =
            loggingScope.tryGetService(ILoggerFactory)?.createLogger('KinesisApplication') ??
            NullLogger.instance;
          logger.logError(
            ex,
            `Processing Kinesis record ${record.kinesis?.sequenceNumber} failed; resuming from the last checkpoint`,
          );
        } finally {
          if (loggingScope.disposeAsync) {
            await loggingScope.disposeAsync();
          } else {
            loggingScope.dispose();
          }
        }

        return; // Stop this partition's group; the record stays unconfirmed and is reported.
      }

      // A failure result or a null/unestablished outcome (isSuccessful never set — typically an
      // unrouted record) stops the group and is reported for redelivery, not checkpointed past —
      // the stream's retention + `ReportBatchItemFailures` redrive is the backstop (matching the
      // DynamoDB adapter's `context.isSuccessful !== true` retain rule).
      if (context.isSuccessful !== true) {
        return;
      }

      checkpointer.checkpoint(record);
    }
  }
}

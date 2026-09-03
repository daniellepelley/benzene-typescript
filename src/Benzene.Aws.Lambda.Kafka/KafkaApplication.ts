/** Port of Benzene.Aws.Lambda.Kafka.KafkaApplication. */
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzenejs/abstractions';
import {
  IMiddlewareApplicationWithResult,
  IMiddlewarePipeline,
} from '@benzenejs/abstractions-middleware';
import { TransportMiddlewarePipeline, TransportNames } from '@benzenejs/core-message-handlers';
import { MSKEvent, MSKRecord } from 'aws-lambda';
import { KafkaBatchFailureMode } from './KafkaBatchFailureMode';
import { KafkaBatchProcessingException } from './KafkaBatchProcessingException';
import { KafkaBatchItemFailure, KafkaBatchResponse } from './KafkaBatchResponse';
import { KafkaContext } from './KafkaContext';
import { KafkaOptions } from './KafkaOptions';

/**
 * Processes a Kafka event, honouring Kafka's per-partition ordering guarantee: records within a single
 * topic-partition run SEQUENTIALLY in offset order and stop at the first failure, while different
 * topic-partitions fan out concurrently. Each partition that fails reports the offset to resume from in
 * a `KafkaBatchResponse`, for triggers with `ReportBatchItemFailures` configured.
 *
 * Faithful to .NET: this replaces the earlier flatten-and-fan-out-every-record behaviour (which
 * discarded partition grouping and never reported failures — a returned failure result was silently
 * dropped), exactly as the C# `KafkaApplication` was rewritten to do. C#
 * `IMiddlewareApplication<KafkaEvent, KafkaBatchResponse>` maps to
 * `IMiddlewareApplicationWithResult<MSKEvent, KafkaBatchResponse>` per the `WithResult` suffix rule.
 * STRUCTURAL note: the event's `records` is an OBJECT keyed by `"topic-partition"`, which is exactly
 * the per-partition grouping the sequential processing needs.
 */
export class KafkaApplication implements IMiddlewareApplicationWithResult<MSKEvent, KafkaBatchResponse> {
  private readonly pipeline: IMiddlewarePipeline<KafkaContext>;
  private readonly options: KafkaOptions;

  constructor(pipeline: IMiddlewarePipeline<KafkaContext>, options?: KafkaOptions) {
    this.pipeline = new TransportMiddlewarePipeline<KafkaContext>(TransportNames.Kafka, pipeline);
    this.options = options ?? new KafkaOptions();
  }

  /**
   * Handles a Kafka batch event. Each topic-partition is processed on its own task; within it, records
   * run one at a time in offset order and processing stops at the first failed record, preserving
   * Kafka's ordering. Returns a `KafkaBatchResponse` naming each failed partition's resume offset, so
   * the event source mapping redrives only those partitions — or, under
   * `KafkaBatchFailureMode.FailWholeBatch`, throws a `KafkaBatchProcessingException` when at least one
   * partition failed.
   */
  async handleAsync(
    event: MSKEvent,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<KafkaBatchResponse> {
    const perPartition = await Promise.all(
      Object.entries(event.records ?? {}).map(([partitionKey, records]) =>
        this.processPartitionAsync(event, partitionKey, records, serviceResolverFactory),
      ),
    );

    const failures = perPartition.filter(
      (failure): failure is KafkaBatchItemFailure => failure !== undefined,
    );

    if (failures.length > 0 && this.options.batchFailureMode === KafkaBatchFailureMode.FailWholeBatch) {
      throw new KafkaBatchProcessingException(failures.map((f) => f.itemIdentifier.partition));
    }

    return { batchItemFailures: failures };
  }

  private async processPartitionAsync(
    event: MSKEvent,
    partitionKey: string,
    records: MSKRecord[],
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<KafkaBatchItemFailure | undefined> {
    for (const record of [...records].sort((a, b) => a.offset - b.offset)) {
      const context = new KafkaContext(event, record);

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
            loggingScope.tryGetService(ILoggerFactory)?.createLogger('KafkaApplication') ??
            NullLogger.instance;
          logger.logError(ex, `Processing Kafka record ${partitionKey}@${record.offset} failed`);
        } finally {
          if (loggingScope.disposeAsync) {
            await loggingScope.disposeAsync();
          } else {
            loggingScope.dispose();
          }
        }

        return { itemIdentifier: { partition: partitionKey, offset: record.offset } };
      }

      // CARVE-OUT — only an explicit failure result (isSuccessful === false) stops the partition. An
      // unset outcome (null/undefined — e.g. an unroutable record whose topic matched no handler) is
      // treated as processed and skipped, so a record no handler wants can't wedge the partition into
      // an infinite resume loop — Kafka has no per-record DLQ the way SQS does; a reported failure
      // replays the partition from that offset. Do not "fix" this to `!== true` without reading
      // benzene-dotnet's work/settlement-consistency-fix-plan.md (row 14).
      if (context.messageResult?.isSuccessful === false) {
        return { itemIdentifier: { partition: partitionKey, offset: record.offset } };
      }
    }

    return undefined;
  }
}

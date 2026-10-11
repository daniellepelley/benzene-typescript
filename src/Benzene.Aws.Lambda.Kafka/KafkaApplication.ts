/** Port of Benzene.Aws.Lambda.Kafka.KafkaApplication. */
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzenejs/abstractions';
import { IMiddlewareApplicationWithResult, IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { BoundedFanOut } from '@benzenejs/core-middleware';
import { isSettledAsFailure, TransportMiddlewarePipeline, TransportNames } from '@benzenejs/core-message-handlers';
import { MSKEvent, MSKRecord } from 'aws-lambda';
import { KafkaBatchFailureMode } from './KafkaBatchFailureMode';
import { KafkaBatchProcessingException } from './KafkaBatchProcessingException';
import { KafkaBatchItemFailure, KafkaBatchResponse } from './KafkaBatchResponse';
import { KafkaContext } from './KafkaContext';
import { KafkaOptions } from './KafkaOptions';

/**
 * Processes an MSK / self-managed Kafka batch per topic-partition: records within a partition run
 * sequentially in offset order (each in its own DI scope, transport tagged `"kafka"`), stopping at the
 * first one that must be redelivered and reporting `{ partition, offset }` for it; partitions fan out,
 * bounded by `KafkaOptions.maxDegreeOfParallelism`. See `KafkaOptions` for the settlement defaults.
 *
 * Faithful to .NET's `KafkaApplication` (previously this port ran every record concurrently and reported
 * nothing, so a failed record was always acknowledged).
 */
export class KafkaApplication implements IMiddlewareApplicationWithResult<MSKEvent, KafkaBatchResponse> {
  private readonly pipeline: IMiddlewarePipeline<KafkaContext>;
  private readonly options: KafkaOptions;

  constructor(pipeline: IMiddlewarePipeline<KafkaContext>, options?: KafkaOptions) {
    this.pipeline = new TransportMiddlewarePipeline<KafkaContext>(TransportNames.Kafka, pipeline);
    this.options = options ?? new KafkaOptions();
  }

  async handleAsync(event: MSKEvent, serviceResolverFactory: IServiceResolverFactory): Promise<KafkaBatchResponse> {
    const partitions = Object.entries(event.records ?? {});
    const perPartition = await BoundedFanOut.whenAllAsync(
      partitions,
      ([partitionKey, records]) => this.processPartitionAsync(event, partitionKey, records, serviceResolverFactory),
      this.options.maxDegreeOfParallelism,
    );

    const failures = perPartition.filter((failure): failure is KafkaBatchItemFailure => failure !== undefined);

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
        await logFailure(serviceResolverFactory, ex, partitionKey, record.offset);
        if (this.options.atMostOnce) {
          continue;
        }
        return failureAt(partitionKey, record);
      }

      // A failure result stops the partition; a missing result is acknowledged (the stream carve-out —
      // see KafkaOptions); an unmatched topic follows ignoreUnmatchedTopics.
      if (
        !this.options.atMostOnce &&
        isSettledAsFailure(context.messageResult, {
          ignoreUnmatchedTopics: this.options.ignoreUnmatchedTopics,
          missingResult: 'acknowledge',
        })
      ) {
        return failureAt(partitionKey, record);
      }
    }

    return undefined;
  }
}

function failureAt(partitionKey: string, record: MSKRecord): KafkaBatchItemFailure {
  return { itemIdentifier: { partition: partitionKey, offset: record.offset } };
}

async function logFailure(
  serviceResolverFactory: IServiceResolverFactory,
  ex: unknown,
  partitionKey: string,
  offset: number,
): Promise<void> {
  const loggingScope = serviceResolverFactory.createScope();
  try {
    const logger = loggingScope.tryGetService(ILoggerFactory)?.createLogger('KafkaApplication') ?? NullLogger.instance;
    logger.logError(ex, `Processing Kafka record ${partitionKey}@${offset} failed`);
  } finally {
    if (loggingScope.disposeAsync) {
      await loggingScope.disposeAsync();
    } else {
      loggingScope.dispose();
    }
  }
}

/**
 * Port of Benzene.Aws.Lambda.Kafka.KafkaBatchProcessingException.
 *
 * Thrown by `KafkaApplication` when `KafkaOptions.batchFailureMode` is set to
 * `KafkaBatchFailureMode.FailWholeBatch` and at least one record in the batch failed — letting the
 * exception propagate out of the Lambda invocation fails the whole batch, so the event source mapping
 * retries every record rather than just the partitions that actually failed. C# `Exception` maps to
 * `Error`.
 */
export class KafkaBatchProcessingException extends Error {
  /** The `topic-partition` keys that failed within the batch. */
  readonly failedPartitions: readonly string[];

  constructor(failedPartitions: readonly string[]) {
    super(
      `${failedPartitions.length} of the batch's topic-partition(s) failed: ${failedPartitions.join(', ')}`,
    );
    this.name = 'KafkaBatchProcessingException';
    this.failedPartitions = failedPartitions;
  }
}

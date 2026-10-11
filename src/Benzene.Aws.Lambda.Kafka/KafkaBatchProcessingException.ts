/**
 * Port of Benzene.Aws.Lambda.Kafka.KafkaBatchProcessingException: thrown under
 * `KafkaBatchFailureMode.FailWholeBatch` when any record failed, so the mapping retries the whole batch.
 */
export class KafkaBatchProcessingException extends Error {
  /** The topic-partitions that failed. */
  readonly partitions: string[];

  constructor(partitions: string[]) {
    super(`Kafka records failed in topic-partitions ${partitions.join(', ')}; failing the whole batch.`);
    this.name = 'KafkaBatchProcessingException';
    this.partitions = partitions;
  }
}

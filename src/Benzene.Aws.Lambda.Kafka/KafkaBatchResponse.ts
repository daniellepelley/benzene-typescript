/**
 * Port of Benzene.Aws.Lambda.Kafka.KafkaBatchResponse — the partial-batch response the MSK / self-managed
 * Kafka event source mapping reads when `ReportBatchItemFailures` is configured. Unlike SQS's string
 * identifier, a Kafka item identifier is an object naming the topic-partition and the offset to resume
 * from. (`@types/aws-lambda` has no type for it.)
 */
export interface KafkaBatchResponse {
  batchItemFailures: KafkaBatchItemFailure[];
}

/** One failed topic-partition and the offset its redrive resumes from. */
export interface KafkaBatchItemFailure {
  itemIdentifier: { partition: string; offset: number };
}

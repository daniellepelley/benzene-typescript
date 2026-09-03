/**
 * Port of Benzene.Aws.Lambda.Kafka.KafkaBatchFailureMode.
 *
 * Controls how a single Kafka record's failure (a thrown exception, or a message handler reporting an
 * unsuccessful result) affects the rest of the batch.
 */
export enum KafkaBatchFailureMode {
  /**
   * The AWS best-practice default. Each topic-partition that fails is reported back via
   * `KafkaBatchResponse.batchItemFailures` naming the offset to resume from, so the event source
   * mapping redrives just that partition from that offset — the rest of the batch (and every earlier
   * record in the failed partition) is treated as successfully processed. Requires
   * `ReportBatchItemFailures` to be configured on the event source mapping's `FunctionResponseTypes`;
   * without it, AWS ignores the returned response and treats the whole invocation as either fully
   * succeeded or fully failed.
   */
  PartialBatchFailure = 0,

  /**
   * Any failure in the batch fails the entire Lambda invocation (by throwing), so the event source
   * mapping retries every record in the batch, not just the partitions that failed. Useful when the
   * event source mapping doesn't have `ReportBatchItemFailures` configured, or when a failure should
   * stop the whole invocation.
   */
  FailWholeBatch = 1,
}

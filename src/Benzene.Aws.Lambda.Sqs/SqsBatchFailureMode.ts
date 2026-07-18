/**
 * Port of Benzene.Aws.Lambda.Sqs.SqsBatchFailureMode.
 *
 * Controls how a single SQS message's failure (a thrown exception, or a message handler reporting an
 * unsuccessful result) affects the rest of the batch.
 */
export enum SqsBatchFailureMode {
  /**
   * The AWS best-practice default. Only the messages that actually failed are reported back via
   * `SQSBatchResponse.batchItemFailures`, so SQS redrives just those messages. Requires
   * `ReportBatchItemFailures` on the SQS event source mapping's `FunctionResponseTypes`.
   */
  PartialBatchFailure = 0,

  /**
   * The first failure in the batch fails the entire Lambda invocation (by throwing), so SQS retries
   * every message in the batch, not just the ones that failed.
   */
  FailWholeBatch = 1,
}

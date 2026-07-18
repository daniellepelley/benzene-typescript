/**
 * Port of Benzene.Aws.Lambda.Sqs.SqsBatchProcessingException.
 *
 * Thrown by `SqsApplication` when `SqsOptions.batchFailureMode` is `SqsBatchFailureMode.FailWholeBatch`
 * and at least one message in the batch failed — letting the error propagate out of the Lambda
 * invocation fails the whole batch, so SQS retries every message rather than just the failed ones.
 * C# `Exception` maps to `Error`.
 */
export class SqsBatchProcessingException extends Error {
  /** The message IDs that failed within the batch. */
  readonly failedMessageIds: readonly string[];

  constructor(failedMessageIds: readonly string[]) {
    super(
      `${failedMessageIds.length} of the batch's message(s) failed: ${failedMessageIds.join(', ')}`,
    );
    this.name = 'SqsBatchProcessingException';
    this.failedMessageIds = failedMessageIds;
  }
}

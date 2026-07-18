import { SqsBatchFailureMode } from './SqsBatchFailureMode';

/**
 * Port of Benzene.Aws.Lambda.Sqs.SqsOptions.
 *
 * Configures how `SqsApplication` handles per-message failures within a batch.
 */
export class SqsOptions {
  /** How a single message's failure affects the rest of the batch. Defaults to partial-batch-failure. */
  batchFailureMode: SqsBatchFailureMode = SqsBatchFailureMode.PartialBatchFailure;
}

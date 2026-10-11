import { SettlementOptions } from '@benzenejs/core-message-handlers';
import { SqsBatchFailureMode } from './SqsBatchFailureMode';

/**
 * Port of Benzene.Aws.Lambda.Sqs.SqsOptions.
 *
 * Configures how `SqsApplication` settles each message of a batch (transport-bindings §1, obligation 8) —
 * a **queue** binding. By default a failure result, a missing result and an uncaught exception are all
 * reported as batch item failures, so SQS redelivers just those messages (subject to the queue's redrive
 * policy / DLQ); handlers must be idempotent. Partial reporting needs `ReportBatchItemFailures` on the
 * event source mapping.
 */
export class SqsOptions implements SettlementOptions {
  /** How a single message's failure affects the rest of the batch. Defaults to partial-batch-failure. */
  batchFailureMode: SqsBatchFailureMode = SqsBatchFailureMode.PartialBatchFailure;

  /** See {@link SettlementOptions.atMostOnce}: report no failures — every message is deleted. */
  atMostOnce = false;

  /** See {@link SettlementOptions.ignoreUnmatchedTopics}: delete a message whose topic no handler serves. */
  ignoreUnmatchedTopics = false;
}

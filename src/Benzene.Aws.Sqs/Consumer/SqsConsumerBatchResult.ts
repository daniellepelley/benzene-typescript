/** Port of Benzene.Aws.Sqs.Consumer.SqsConsumerBatchResult. */
import type { Message } from '@aws-sdk/client-sqs';

/**
 * The outcome of running one poll batch through the pipeline, split into the messages that succeeded and
 * the messages that failed (a thrown exception or an unsuccessful/unset result).
 */
export class SqsConsumerBatchResult {
  constructor(
    readonly successfulMessages: readonly Message[],
    readonly failedMessages: readonly Message[],
  ) {}
}

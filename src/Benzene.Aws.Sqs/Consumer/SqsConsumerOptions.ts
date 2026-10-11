/** Port of Benzene.Aws.Sqs.Consumer.SqsConsumerOptions. */
import { SettlementOptions } from '@benzenejs/core-message-handlers';
import { SqsConsumerAckMode } from './SqsConsumerAckMode';

/**
 * Configures how {@link SqsConsumer} acknowledges (deletes) messages after processing a poll batch — a
 * **queue** binding (transport-bindings §1, obligation 8). By default only a message whose result is
 * successful is deleted; a failure result, no result and an uncaught exception leave the message on the
 * queue to reappear after its visibility timeout (subject to the queue's redrive policy / DLQ).
 *
 * The settlement knobs every one-way binding carries are optional here (`atMostOnce`: delete every
 * message whatever the outcome; `ignoreUnmatchedTopics`: delete a message whose topic no handler serves).
 */
export interface SqsConsumerOptions extends Partial<SettlementOptions> {
  /**
   * Whether messages are deleted as a whole batch or individually. Defaults to
   * {@link SqsConsumerAckMode.PerMessage} — only messages that actually succeeded are deleted.
   */
  ackMode?: SqsConsumerAckMode;
  /**
   * The maximum number of messages from a single poll batch processed concurrently. `undefined` (the
   * default) leaves the fan-out unbounded. A value `<= 0` is treated as unbounded.
   */
  maxDegreeOfParallelism?: number;
}

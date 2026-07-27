/** Port of Benzene.Aws.Sqs.Consumer.SqsConsumerAckMode. */

/**
 * Controls whether {@link SqsConsumer} deletes an entire poll batch as a unit, or deletes only the messages
 * that succeeded.
 */
export const SqsConsumerAckMode = {
  /**
   * Every message in the poll batch is deleted together, only once the whole batch finished without any
   * message throwing. If any handler throws, no messages are deleted — the batch is left to be retried. The
   * older, less-safe behaviour.
   */
  WholeBatch: 0,
  /**
   * The default. Only the messages that succeeded (explicit success, no throw, no unsuccessful/unset result)
   * are deleted; failed or unrouted messages stay on the queue individually for redelivery/DLQ redrive.
   */
  PerMessage: 1,
} as const;

export type SqsConsumerAckMode = (typeof SqsConsumerAckMode)[keyof typeof SqsConsumerAckMode];

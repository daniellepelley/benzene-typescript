/** Port of Benzene.Aws.Sqs.Consumer.SqsConsumerOptions. */
import { SqsConsumerAckMode } from './SqsConsumerAckMode';

/** Configures how {@link SqsConsumer} acknowledges (deletes) messages after processing a poll batch. */
export interface SqsConsumerOptions {
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

/** Port of Benzene.Azure.Function.Kafka.KafkaOptions. */

/**
 * Configures how `KafkaApplication` / `KafkaBatchApplication` handle a message handler's exceptions and
 * failure results. Both flags default to `false` (purely additive/opt-in), preserving the original
 * behavior: a handler exception cascades and fails the whole trigger invocation, and a non-exception
 * failure result is silently accepted.
 */
export class KafkaOptions {
  /**
   * Whether an unhandled exception from a message handler is caught (logged, that event's failure
   * doesn't affect the rest of the batch) instead of left to cascade and fail the whole trigger
   * invocation. Defaults to `false` — the Kafka trigger has no platform-level partial-batch-failure
   * mechanism (unlike AWS Lambda SQS), so an uncaught exception failing the whole invocation is the
   * only way the Functions host's own retry policy notices anything went wrong.
   */
  catchExceptions = false;

  /**
   * Whether a message handler returning a non-exception failure result is escalated into a thrown
   * `KafkaMessageProcessingException`, so a failure is treated the same as an unhandled exception for
   * retry purposes. Defaults to `false` — a failure result usually reflects a permanent/business-logic
   * failure that retrying won't fix.
   */
  raiseOnFailureStatus = false;
}

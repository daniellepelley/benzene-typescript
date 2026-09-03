/** Port of Benzene.Azure.Function.Kafka.KafkaOptions. */

/**
 * Configures how `KafkaApplication` / `KafkaBatchApplication` handle a message handler's exceptions and
 * failure results. Safe-by-default on the failure-result axis, matching the .NET 1.0 settlement
 * contract: `catchExceptions` off (a handler exception cascades and fails the trigger invocation) and
 * `raiseOnFailureStatus` on (a returned failure result is escalated the same way). A null/unestablished
 * outcome is deliberately NOT escalated — see the carve-out comment in `KafkaBatchApplication`.
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
   * retry purposes. Defaults to `true` — a returned failure is not silently settled; the Functions
   * host's own retry policy takes over, and the handler must be idempotent. Set `false` for
   * at-most-once, where a failure result is accepted as settled.
   */
  raiseOnFailureStatus = true;
}

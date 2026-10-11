/** Port of Benzene.Azure.Function.Kafka.KafkaOptions. */
import { SettlementOptions } from '@benzenejs/core-message-handlers';

/**
 * Configures how `KafkaApplication` / `KafkaBatchApplication` settle a Kafka trigger batch
 * (transport-bindings §1, obligation 8) — a **stream** binding. The unit of settlement is the
 * **invocation** (the whole batch): a failure fails it, and whether the Functions host then redelivers the
 * batch depends on the trigger's retry policy, which the application configures.
 *
 * Defaults, and the stream carve-out they document (matching .NET's `KafkaApplication`, whose base class
 * overrides `EscalateUnestablishedOutcome` to `false` for this trigger):
 * - a **failure result** or an **uncaught exception** fails the invocation — redelivered;
 * - a **missing result** is acknowledged (skip-and-continue): Kafka has no per-record dead-letter path, so
 *   retaining it would replay the batch forever;
 * - an **unmatched topic** is acknowledged too (`ignoreUnmatchedTopics` defaults `true` here); set it
 *   `false` to fail the invocation instead.
 */
export class KafkaOptions implements SettlementOptions {
  /**
   * Whether an unhandled exception from a message handler is caught (logged, that event's failure
   * doesn't affect the rest of the batch) instead of left to cascade and fail the whole trigger
   * invocation. Defaults to `false` — the Kafka trigger has no platform-level partial-batch-failure
   * mechanism (unlike AWS Lambda SQS), so an uncaught exception failing the whole invocation is the
   * only way the Functions host's own retry policy notices anything went wrong.
   */
  catchExceptions = false;

  /**
   * Whether a failure result is escalated into a thrown `KafkaMessageProcessingException`, so it is
   * treated the same as an unhandled exception for retry purposes. Defaults to `true` (.NET's default; was
   * `false` before spec-0.2.0).
   */
  raiseOnFailureStatus = true;

  /** See {@link SettlementOptions.atMostOnce}: acknowledge the batch, whatever the outcome. */
  atMostOnce = false;

  /** See {@link SettlementOptions.ignoreUnmatchedTopics}. Defaults to `true` on this stream binding. */
  ignoreUnmatchedTopics = true;
}

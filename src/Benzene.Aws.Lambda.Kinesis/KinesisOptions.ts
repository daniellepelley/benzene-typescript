import { SettlementOptions } from '@benzenejs/core-message-handlers';

/**
 * Configures how `KinesisApplication` settles a Kinesis batch (transport-bindings §1, obligation 8) — a
 * **stream** binding.
 *
 * The unit of settlement is the **invocation** (the whole batch): records run concurrently, one pipeline
 * and scope each, and a failure fails the invocation so Lambda retries the whole batch (bound it with the
 * event source mapping's `MaximumRetryAttempts`, `BisectBatchOnFunctionError` and on-failure destination —
 * a failing batch blocks its shard until then). Shard order is not preserved across records.
 *
 * Defaults, and the stream carve-out they document (the spec lets a stream binding skip-and-continue):
 * - a **failure result** fails the invocation — redelivered (`raiseOnFailureStatus`, default `true`);
 * - an **uncaught exception** fails the invocation — redelivered (`catchExceptions`, default `false`);
 * - a **missing result** is acknowledged (skip-and-continue), as .NET does for its other stream triggers
 *   (Kafka, Event Hub): retaining it would replay the whole batch for a record nothing claims;
 * - an **unmatched topic** is acknowledged (`ignoreUnmatchedTopics` defaults `true` here), for the same
 *   reason — note a Kinesis record carries no topic, so routing needs `usePresetTopic`.
 *
 * TypeScript-only type: .NET's Kinesis binding is a fan-in stream application with a checkpointer
 * (`KinesisStreamOptions`), which this port does not have; this per-record adaptation settles by
 * invocation instead.
 */
export class KinesisOptions implements SettlementOptions {
  /** Whether an uncaught exception is caught (logged; the record is acknowledged). Defaults to `false`. */
  catchExceptions = false;

  /** Whether a failure result fails the invocation so the batch is retried. Defaults to `true`. */
  raiseOnFailureStatus = true;

  /** See {@link SettlementOptions.atMostOnce}: acknowledge the batch, whatever the outcome. */
  atMostOnce = false;

  /**
   * See {@link SettlementOptions.ignoreUnmatchedTopics}. Defaults to `true` on this stream binding
   * (skip-and-continue for a record no handler serves); set `false` to retry the batch instead.
   */
  ignoreUnmatchedTopics = true;
}

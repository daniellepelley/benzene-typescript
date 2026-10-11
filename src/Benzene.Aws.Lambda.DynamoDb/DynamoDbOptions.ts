import { SettlementOptions } from '@benzenejs/core-message-handlers';

/**
 * Configures how `DynamoDbApplication` settles a DynamoDB Streams batch (transport-bindings §1,
 * obligation 8) — a **stream** binding whose records are ordered change-data-capture.
 *
 * The unit of settlement is the **position**: records run in order, and processing stops at the first one
 * that failed — a failure result, no result, or an uncaught exception — reporting its sequence number as
 * the batch item failure, so Lambda resumes the shard from that record (every earlier record is
 * acknowledged). This binding does **not** skip-and-continue by default: a failed record is redelivered,
 * matching .NET's `DynamoDbApplication`. Reporting needs `ReportBatchItemFailures` on the event source
 * mapping; bound the retries with its `MaximumRetryAttempts` / on-failure destination.
 *
 * TypeScript-only type: the .NET binding has no options, and so no at-most-once override yet; spec-0.2.0
 * requires one on every one-way binding.
 */
export class DynamoDbOptions implements SettlementOptions {
  /** See {@link SettlementOptions.atMostOnce}: never report a failure — every record is acknowledged. */
  atMostOnce = false;

  /** See {@link SettlementOptions.ignoreUnmatchedTopics}: acknowledge a `{table}:{event}` no handler serves. */
  ignoreUnmatchedTopics = false;
}

import { SettlementOptions } from '@benzenejs/core-message-handlers';
import { KafkaBatchFailureMode } from './KafkaBatchFailureMode';

/**
 * Port of Benzene.Aws.Lambda.Kafka.KafkaOptions: configures how `KafkaApplication` settles an MSK /
 * self-managed Kafka batch (transport-bindings §1, obligation 8) — a **stream** binding.
 *
 * The unit of settlement is the **topic-partition position**: records within a partition run sequentially
 * in offset order and processing stops at the first failure, reported as `{ partition, offset }` so the
 * mapping resumes that partition from that record; partitions run independently.
 *
 * Defaults, and the stream carve-out they document (matching .NET's `KafkaApplication`):
 * - a **failure result** or an **uncaught exception** stops the partition — redelivered;
 * - a **missing result** is acknowledged and processing continues (skip-and-continue): Kafka has no
 *   per-record dead-letter queue, so retaining it would replay the partition forever;
 * - an **unmatched topic** is acknowledged too (`ignoreUnmatchedTopics` defaults `true` here — in .NET an
 *   unrouted record is a missing result); set it `false` to stop the partition instead.
 */
export class KafkaOptions implements SettlementOptions {
  /** How a single record's failure affects the rest of the batch. Defaults to partial-batch-failure. */
  batchFailureMode: KafkaBatchFailureMode = KafkaBatchFailureMode.PartialBatchFailure;

  /**
   * The maximum number of topic-partitions processed concurrently. `undefined` (the default) leaves the
   * fan-out unbounded; a value <= 0 is treated the same. Records within a partition always run in order.
   */
  maxDegreeOfParallelism?: number;

  /** See {@link SettlementOptions.atMostOnce}: report no failures — every record is acknowledged. */
  atMostOnce = false;

  /** See {@link SettlementOptions.ignoreUnmatchedTopics}. Defaults to `true` on this stream binding. */
  ignoreUnmatchedTopics = true;
}

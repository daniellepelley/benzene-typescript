/** Port of Benzene.Kafka.Core.BenzeneKafkaConfig. */

/**
 * Configures the processing behaviour used by {@link BenzeneKafkaWorker}, plus the topics to subscribe
 * to.
 *
 * PORTING NOTE — the config bag. The C# class carries a raw Confluent `ConsumerConfig` (bootstrap
 * servers, group id, SASL/SSL, …) alongside `Topics` and the behaviour flags, because .NET's worker
 * *builds* the consumer from that config. In kafkajs the connection settings are split across the
 * `Kafka` client (`brokers`) and the `consumer` (`groupId`), and the **caller builds both and hands the
 * ready `Consumer` to {@link IKafkaConsumerFactory}** — exactly the Event Hubs seam split (hub/
 * consumer-group live on the caller-built client, not on `BenzeneEventHubConfig`). So this config carries
 * only what Benzene itself decides: the `topics` to subscribe to, `fromBeginning` (the kafkajs subscribe
 * option, the analog of Confluent's `AutoOffsetReset`), and the behaviour flags below. `brokers`/`groupId`
 * are *not* fields here — they belong on the caller-built `Consumer`. See the README porting-conventions
 * bullet.
 *
 * The C# class (get/set properties with defaults) becomes an interface with optional members;
 * {@link withKafkaConfigDefaults} applies the same defaults the C# property initializers do.
 */
export interface BenzeneKafkaConfig {
  /** The topics the worker subscribes to. Mapped to the kafkajs `consumer.subscribe({ topics })` call. */
  topics: string[];

  /**
   * Where a partition starts reading when the consumer group has no committed offset. `undefined` (the
   * default) leaves kafkajs's own default (`false` — read only new records). Set `true` to process the
   * retained backlog on first run. Mapped to `consumer.subscribe({ fromBeginning })`. Confluent
   * equivalent: `ConsumerConfig.AutoOffsetReset`.
   */
  fromBeginning?: boolean;

  /**
   * The maximum number of partitions handled concurrently. Defaults to 5. Mapped to kafkajs
   * `consumer.run({ partitionsConsumedConcurrently })`. (The C# `ConcurrentRequests` bounds concurrent
   * message handlers via a `BoundedConcurrentDispatcher`; kafkajs's push model instead parallelises by
   * partition — see the README porting-conventions bullet.)
   */
  concurrentRequests?: number;

  /**
   * When `true` (the default), a partition's records are handled in order. This is inherent to kafkajs's
   * `eachMessage` model — the SDK delivers a partition's records sequentially — so this flag cannot be
   * turned off to get unordered round-robin dispatch the way the C# `BoundedConcurrentDispatcher` can;
   * it is retained (defaulting `true`) only to keep the `commitOnlyOnSuccess` startup validation faithful
   * to the C#. See the README porting-conventions bullet.
   */
  preserveOrderPerPartition?: boolean;

  /**
   * Whether an unhandled exception from a record's handler is caught (logged, consumption continues) or
   * left to stop the worker entirely. Defaults to `true` (catch) — a single bad record shouldn't take
   * down the whole consumer. Set `false` to instead stop the worker (disconnecting the consumer) on the
   * first unhandled handler exception.
   */
  catchHandlerExceptions?: boolean;

  /**
   * Whether an offset is committed only after its record's handler completes successfully, instead of
   * kafkajs's periodic auto-commit. Defaults to `false` (auto-commit). Set `true` for at-least-once
   * processing: a record whose handler fails (or whose worker crashes mid-handling) is redelivered on
   * restart/rebalance instead of being silently skipped.
   *
   * Requires `catchHandlerExceptions = false` and `preserveOrderPerPartition = true` — enforced at
   * worker startup, matching the C#. Mapped to kafkajs `consumer.run({ autoCommit: false })` plus an
   * explicit `consumer.commitOffsets(...)` after each successful handle. (kafkajs commits the *next*
   * offset to read, so the worker commits `record.offset + 1`.)
   */
  commitOnlyOnSuccess?: boolean;
}

/** Fills in the C# property-initializer defaults for the fields the worker reads. */
export function withKafkaConfigDefaults(
  config: BenzeneKafkaConfig,
): BenzeneKafkaConfig &
  Required<
    Pick<
      BenzeneKafkaConfig,
      'concurrentRequests' | 'preserveOrderPerPartition' | 'catchHandlerExceptions' | 'commitOnlyOnSuccess'
    >
  > {
  return {
    ...config,
    concurrentRequests: config.concurrentRequests ?? 5,
    preserveOrderPerPartition: config.preserveOrderPerPartition ?? true,
    catchHandlerExceptions: config.catchHandlerExceptions ?? true,
    commitOnlyOnSuccess: config.commitOnlyOnSuccess ?? false,
  };
}

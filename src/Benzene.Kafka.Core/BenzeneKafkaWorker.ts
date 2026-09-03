/** Port of Benzene.Kafka.Core.BenzeneKafkaWorker. */
import { Consumer, EachMessagePayload } from 'kafkajs';
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzenejs/abstractions';
import { IBenzeneWorker } from '@benzenejs/abstractions-middleware';
import { BenzeneKafkaConfig, withKafkaConfigDefaults } from './BenzeneKafkaConfig';
import { IKafkaConsumerFactory } from './IKafkaConsumerFactory';
import { KafkaApplication } from './KafkaMessage/KafkaApplication';

/**
 * A long-running worker that consumes Kafka records and dispatches each through the middleware
 * pipeline — for `@benzenejs/self-host`, not a cloud trigger (use `@benzenejs/aws-lambda-kafka` /
 * `@benzenejs/azure-function-kafka` for those).
 *
 * PORTING NOTE — the SDK's consume model. .NET hand-rolls a synchronous `IConsumer.Consume()` poll loop
 * on a background task and dispatches each `ConsumeResult` through a `BoundedConcurrentDispatcher`
 * (bounded concurrency + per-partition ordering lanes). kafkajs has **no synchronous `Consume()`**; it
 * is push-based — `consumer.run({ eachMessage })` invokes a callback per record, delivering a partition's
 * records *sequentially* (so per-partition ordering is inherent, not something the worker arranges).
 * The mapping:
 *
 * - `ConcurrentRequests` → `partitionsConsumedConcurrently` (kafkajs parallelises across partitions
 *   rather than bounding a shared handler pool).
 * - `PreserveOrderPerPartition` → inherent to `eachMessage` (a partition's records arrive in order); the
 *   flag is retained only to keep the `commitOnlyOnSuccess` startup validation faithful to the C#.
 * - `CatchHandlerExceptions` `true` → catch, log, and let consumption continue; `false` → stop the
 *   worker by disconnecting the consumer (kafkajs would otherwise *retry* a record whose `eachMessage`
 *   throws, so the worker swallows-then-disconnects instead of rethrowing).
 * - `CommitOnlyOnSuccess` → `autoCommit: false` plus an explicit `consumer.commitOffsets(...)` after a
 *   record is handled without throwing AND without a returned failure result (`raiseOnFailureStatus`,
 *   default `true`, settles a returned failure like a throw — see `BenzeneKafkaConfig`). kafkajs commits
 *   the *next* offset to read, so the worker commits `message.offset + 1`.
 *
 * `startAsync` connects, subscribes, and calls `run` (which resolves once the consumer is running,
 * processing in the background) — it does not block until shutdown. `stopAsync` disconnects, which waits
 * for the in-flight `eachMessage` to finish (draining). `CancellationToken` → optional `AbortSignal`
 * (unused: kafkajs shutdown is driven by `disconnect()`, not a token).
 *
 * DEFERRED from the C# worker (documented in the README porting-conventions bullet): the retry-then-
 * dead-letter re-produce (`KafkaDeadLetterOptions`) and the `DrainOnRevoke` rebalance-draining — both
 * lean on Confluent's manual `StoreOffset`/rebalance-handler seams that kafkajs's higher-level push model
 * does not expose in the same shape.
 */
export class BenzeneKafkaWorker implements IBenzeneWorker {
  private readonly config: BenzeneKafkaConfig &
    Required<
      Pick<
        BenzeneKafkaConfig,
        | 'concurrentRequests'
        | 'preserveOrderPerPartition'
        | 'catchHandlerExceptions'
        | 'commitOnlyOnSuccess'
        | 'raiseOnFailureStatus'
      >
    >;
  private consumer: Consumer | undefined;
  private stopInitiated = false;

  constructor(
    private readonly serviceResolverFactory: IServiceResolverFactory,
    private readonly application: KafkaApplication,
    config: BenzeneKafkaConfig,
    private readonly clientFactory: IKafkaConsumerFactory,
  ) {
    this.config = withKafkaConfigDefaults(config);
  }

  /**
   * Connects the consumer, subscribes to the configured topics, and starts running. Returns once the
   * consumer is running — it does not block until shutdown. Use `stopAsync` to stop consuming and drain
   * the in-flight handler.
   */
  async startAsync(_cancellationToken?: AbortSignal): Promise<void> {
    if (this.config.commitOnlyOnSuccess && this.config.catchHandlerExceptions) {
      throw new Error(
        'commitOnlyOnSuccess requires catchHandlerExceptions = false — otherwise a handler exception is ' +
          'swallowed and the record is never committed, but later successful records on the same partition ' +
          'would still advance the commit watermark past it.',
      );
    }
    if (this.config.commitOnlyOnSuccess && !this.config.preserveOrderPerPartition) {
      throw new Error(
        'commitOnlyOnSuccess requires preserveOrderPerPartition = true — otherwise a partition’s records ' +
          'can be handled out of order, and committing a later record first would advance the commit ' +
          'watermark past an earlier one still in flight.',
      );
    }

    const consumer = this.clientFactory.create();
    this.consumer = consumer;

    await consumer.connect();
    await consumer.subscribe({ topics: this.config.topics, fromBeginning: this.config.fromBeginning });
    await consumer.run({
      // Under commitOnlyOnSuccess the worker commits by hand after a successful handle; otherwise leave
      // kafkajs's periodic auto-commit on (the equivalent of Confluent's auto-store-on-consume default).
      autoCommit: !this.config.commitOnlyOnSuccess,
      partitionsConsumedConcurrently: this.config.concurrentRequests,
      eachMessage: (payload) => this.onEachMessage(payload),
    });
  }

  /** Stops consuming — disconnecting the consumer, which waits for the in-flight handler to finish. */
  async stopAsync(_cancellationToken?: AbortSignal): Promise<void> {
    if (this.consumer !== undefined) {
      await this.consumer.disconnect();
      this.consumer = undefined;
    }
  }

  private async onEachMessage(payload: EachMessagePayload): Promise<void> {
    let messageResult;
    try {
      messageResult = await this.application.handleAsync(payload, this.serviceResolverFactory);
    } catch (error) {
      this.logError(
        error,
        `Handling record ${payload.topic}-${payload.partition}-${payload.message.offset} failed`,
      );

      if (!this.config.catchHandlerExceptions) {
        // At-least-once: stop the worker without committing the failed record, so a restart resumes from
        // the last committed offset and redelivers it. Deferred (not awaited) so disconnect starts after
        // this handler returns rather than from inside it — kafkajs would otherwise retry a throwing
        // handler, fighting the disconnect; guarded so a concurrent host stopAsync is safe.
        this.initiateStop();
        return;
      }

      // catchHandlerExceptions (default): skip this record and keep consuming. Under auto-commit kafkajs
      // advances past it (matching the C# "log and keep that lane consuming" behaviour).
      return;
    }

    // A handler that RETURNS a failure result (without throwing) settles like a throw when
    // raiseOnFailureStatus (default true) is on — otherwise a returned failure is indistinguishable
    // from a success and the record is committed as if it had succeeded (the silent-loss default .NET
    // closed in its e967122 fix). CARVE-OUT on the null axis — do not "fix" `=== false` to `!== true`
    // without reading benzene-dotnet's work/settlement-consistency-fix-plan.md (row 16): a null result
    // (most commonly an unrouted record) is deliberately not escalated, because Kafka has no
    // per-record dead-letter backstop and retaining one would replay the partition forever.
    if (this.config.raiseOnFailureStatus && messageResult?.isSuccessful === false) {
      if (this.config.commitOnlyOnSuccess) {
        // Same settlement as a thrown handler exception in this configuration (catchHandlerExceptions
        // is necessarily false here — enforced at startup): log, do NOT commit the offset, and stop
        // the worker so a restart resumes from the last committed offset and redelivers the record.
        this.logError(
          undefined,
          `Handler reported an unsuccessful result for record ` +
            `${payload.topic}-${payload.partition}-${payload.message.offset}; not committing — the ` +
            `record will be redelivered`,
        );
        this.initiateStop();
        return;
      }

      // Default auto-commit configuration: kafkajs's periodic auto-commit advances regardless, so
      // nothing can hold the record back. Surface the loss rather than escalating a failure nothing
      // can act on — enable commitOnlyOnSuccess to retain a failed record.
      this.logWarning(
        `Handler reported an unsuccessful result for record ` +
          `${payload.topic}-${payload.partition}-${payload.message.offset}, but offsets auto-commit ` +
          `so the record cannot be redelivered. Enable commitOnlyOnSuccess to retain a failed record.`,
      );
      return;
    }

    if (this.config.commitOnlyOnSuccess) {
      // kafkajs commits the NEXT offset to read, so commit message.offset + 1. Handled without throwing
      // and (preserveOrderPerPartition) strictly in order, so the watermark never advances past an
      // unhandled record.
      const nextOffset = (BigInt(payload.message.offset) + 1n).toString();
      await this.consumer!.commitOffsets([
        { topic: payload.topic, partition: payload.partition, offset: nextOffset },
      ]);
    }
  }

  private initiateStop(): void {
    if (this.stopInitiated) {
      return;
    }
    this.stopInitiated = true;
    const consumer = this.consumer;
    // Defer so disconnect() starts after this handler returns rather than from inside it.
    queueMicrotask(() => {
      void consumer?.disconnect();
    });
  }

  private logError(error: unknown, message: string): void {
    const loggingScope = this.serviceResolverFactory.createScope();
    try {
      const logger =
        loggingScope.tryGetService(ILoggerFactory)?.createLogger('BenzeneKafkaWorker') ??
        NullLogger.instance;
      logger.logError(error, message);
    } finally {
      loggingScope.dispose();
    }
  }

  private logWarning(message: string): void {
    const loggingScope = this.serviceResolverFactory.createScope();
    try {
      const logger =
        loggingScope.tryGetService(ILoggerFactory)?.createLogger('BenzeneKafkaWorker') ??
        NullLogger.instance;
      logger.logWarning(message);
    } finally {
      loggingScope.dispose();
    }
  }
}

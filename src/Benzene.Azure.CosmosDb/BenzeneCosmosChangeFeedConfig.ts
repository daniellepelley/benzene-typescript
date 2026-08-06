/** Port of Benzene.Azure.CosmosDb.BenzeneCosmosChangeFeedConfig. */

/**
 * Configures the processing behaviour used by {@link BenzeneCosmosChangeFeedWorker}. Which container
 * to monitor, where to persist the continuation-token checkpoint, and how to authenticate are decided
 * by the change-feed processor the caller builds (see {@link ICosmosChangeFeedProcessorFactory}) —
 * this config only covers what Benzene itself decides.
 *
 * PORTING NOTE: the C# class (get/set properties with initializers) becomes a class with field
 * defaults and an optional {@link Partial} constructor — so `new BenzeneCosmosChangeFeedConfig()`
 * yields the C# defaults and `new BenzeneCosmosChangeFeedConfig({ autoCheckpointOnSuccess: false })`
 * is the idiomatic stand-in for a C# object initializer.
 */
export class BenzeneCosmosChangeFeedConfig {
  /**
   * Whether the batch is checkpointed automatically after the pipeline completes successfully without
   * the handler having called the context's checkpointer itself. Defaults to `true`, matching the
   * Azure Functions `CosmosDBTrigger`'s checkpoint-on-successful-return behaviour — a handler that
   * never thinks about checkpointing gets sensible at-least-once semantics for free. Set to `false`
   * for fully manual control: the batch is then only checkpointed when the handler calls
   * `context.checkpointer.checkpointAsync(...)`, and a batch the handler never checkpoints is
   * redelivered after a restart or lease rebalance (the processor still moves forward in-memory within
   * the current lease ownership).
   */
  autoCheckpointOnSuccess = true;

  /**
   * Whether an unhandled exception from the batch's pipeline is caught (logged, the batch is
   * checkpointed anyway, and processing continues — i.e. the poison batch is *permanently skipped*).
   * Defaults to `false`: the exception propagates to the change feed processor, which does not advance
   * the lease and redelivers the same batch — the platform-native at-least-once behaviour. Note this
   * default is the opposite of `BenzeneEventHubConfig.catchHandlerExceptions`: Event Hubs has no
   * per-batch redelivery, so skipping is its only way to keep going, whereas the change feed retries a
   * failed batch natively — a reliably failing batch therefore retries forever under the default, so
   * either handle poison documents inside the pipeline or opt in to skipping here.
   */
  catchHandlerExceptions = false;

  constructor(overrides?: Partial<Pick<BenzeneCosmosChangeFeedConfig, 'autoCheckpointOnSuccess' | 'catchHandlerExceptions'>>) {
    if (overrides?.autoCheckpointOnSuccess !== undefined) {
      this.autoCheckpointOnSuccess = overrides.autoCheckpointOnSuccess;
    }
    if (overrides?.catchHandlerExceptions !== undefined) {
      this.catchHandlerExceptions = overrides.catchHandlerExceptions;
    }
  }
}

/** Port of Benzene.Azure.CosmosDb.BenzeneCosmosChangeFeedWorker. */
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzene/abstractions';
import { IBenzeneWorker } from '@benzene/abstractions-middleware';
import { BenzeneCosmosChangeFeedConfig } from './BenzeneCosmosChangeFeedConfig';
import { ChangeFeedProcessor, ChangeFeedProcessorContext } from './ChangeFeedProcessor';
import { CosmosChangeFeedApplication } from './CosmosChangeFeedApplication';
import { CosmosChangeFeedBatch } from './CosmosChangeFeedBatch';
import { ICosmosChangeFeedProcessorFactory } from './ICosmosChangeFeedProcessorFactory';

/**
 * A long-running worker that consumes a Cosmos DB container's change feed directly and runs each
 * delivered batch through a Benzene streaming pipeline — for `@benzene/self-host`, not Azure Functions
 * (use `@benzene/azure-function-cosmos-db` for a `CosmosDBTrigger`).
 *
 * What this worker adds over the Functions trigger is *manual checkpoint control*: each batch's
 * `StreamContext<TDocument>` carries a real checkpointer wrapping the batch-level checkpoint hook, with
 * auto-checkpoint-on-success as the default
 * ({@link BenzeneCosmosChangeFeedConfig.autoCheckpointOnSuccess}) and skip-vs-retry failure semantics
 * ({@link BenzeneCosmosChangeFeedConfig.catchHandlerExceptions}). {@link startAsync} starts the
 * processor and returns; {@link stopAsync} stops it, waiting for the in-flight batch to finish.
 *
 * PORTING NOTE — the change-feed-processor fork. The .NET SDK's push-model Change Feed Processor
 * (lease ownership, load balancing, in-order batch delivery) has no `@azure/cosmos` equivalent, so the
 * {@link ChangeFeedProcessor} the {@link ICosmosChangeFeedProcessorFactory} hands back is driven by a
 * pull-iterator poll loop (see {@link CosmosChangeFeedProcessorFactory}). The worker itself is a
 * faithful port: it creates the processor from the factory (passing its change/error delegates — the
 * builder requires the handler at build time, unlike `EventProcessorClient`'s attach-after events) and
 * starts it. Cancellation: C# `CancellationToken` → `AbortSignal`; the SDK's start/stop take no token,
 * so the host's tokens are unobserved.
 *
 * @typeParam TDocument The document type the change feed batches are deserialized into.
 */
export class BenzeneCosmosChangeFeedWorker<TDocument> implements IBenzeneWorker {
  private processor: ChangeFeedProcessor | undefined;

  constructor(
    private readonly serviceResolverFactory: IServiceResolverFactory,
    private readonly application: CosmosChangeFeedApplication<TDocument>,
    private readonly config: BenzeneCosmosChangeFeedConfig,
    private readonly processorFactory: ICosmosChangeFeedProcessorFactory<TDocument>,
  ) {}

  /**
   * Creates the processor and starts it. Returns once the processor is running — it does not block
   * until shutdown. Use {@link stopAsync} to stop consuming and wait for the in-flight batch to finish.
   */
  async startAsync(_cancellationToken?: AbortSignal): Promise<void> {
    this.processor = this.processorFactory.create(
      (context, changes, checkpointAsync, cancellationToken) =>
        this.onChangesAsync(context, changes, checkpointAsync, cancellationToken),
      (leaseToken, exception) => this.onErrorAsync(leaseToken, exception),
    );
    await this.processor.startAsync();
  }

  /** Stops the processor, waiting for the in-flight batch handler to finish. */
  async stopAsync(_cancellationToken?: AbortSignal): Promise<void> {
    if (this.processor !== undefined) {
      await this.processor.stopAsync();
    }
  }

  private async onChangesAsync(
    context: ChangeFeedProcessorContext,
    changes: readonly TDocument[],
    checkpointAsync: () => Promise<void>,
    cancellationToken: AbortSignal | undefined,
  ): Promise<void> {
    const batch = new CosmosChangeFeedBatch<TDocument>(
      changes,
      checkpointAsync,
      context.leaseToken,
      cancellationToken,
    );

    try {
      const handlerCheckpointed = await this.application.handleAsync(batch, this.serviceResolverFactory);
      if (!handlerCheckpointed && this.config.autoCheckpointOnSuccess) {
        await checkpointAsync();
      }
    } catch (error) {
      if (cancellationToken?.aborted === true && this.isCancellation(error)) {
        // Shutdown cancelled the batch mid-flight. Even in skip mode (catchHandlerExceptions=true),
        // do NOT checkpoint a partially-processed batch — that silently loses its unprocessed tail.
        // Propagate so the lease isn't advanced and the batch is redelivered.
        throw error;
      }

      this.logError(
        error,
        `Processing change feed batch of ${changes.length} documents on lease ${context.leaseToken} failed`,
      );

      if (this.config.catchHandlerExceptions) {
        // Skip mode: checkpoint the failed batch anyway so it is permanently passed over and the
        // lease keeps moving.
        await checkpointAsync();
      } else {
        // Retry mode (default): let the exception reach the processor — the lease is not advanced and
        // the same batch is redelivered (at-least-once).
        throw error;
      }
    }
  }

  private onErrorAsync(leaseToken: string, exception: unknown): Promise<void> {
    this.logError(exception, `Change feed processing failed on lease ${leaseToken}`);
    return Promise.resolve();
  }

  /** Whether an error is an abort/cancellation (the `AbortSignal` analogue of `OperationCanceledException`). */
  private isCancellation(error: unknown): boolean {
    const name = (error as { name?: unknown } | null | undefined)?.name;
    return name === 'AbortError' || name === 'OperationCanceledError';
  }

  /** Logs an error through the worker's `ILoggerFactory`/`NullLogger` scope, matching the C# pattern. */
  private logError(error: unknown, messageText: string): void {
    const loggingScope = this.serviceResolverFactory.createScope();
    try {
      const logger =
        loggingScope.tryGetService(ILoggerFactory)?.createLogger('BenzeneCosmosChangeFeedWorker') ??
        NullLogger.instance;
      logger.logError(error, messageText);
    } finally {
      loggingScope.dispose();
    }
  }
}

/** Port of Benzene.Azure.CosmosDb.BenzeneCosmosAllVersionsChangeFeedWorker. */
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzene/abstractions';
import { IBenzeneWorker } from '@benzene/abstractions-middleware';
import { BenzeneCosmosAllVersionsChangeFeedConfig } from './BenzeneCosmosAllVersionsChangeFeedConfig';
import {
  ChangeFeedItem,
  ChangeFeedOperationType,
  ChangeFeedProcessor,
  ChangeFeedProcessorContext,
} from './ChangeFeedProcessor';
import { CosmosAllVersionsChangeFeedApplication } from './CosmosAllVersionsChangeFeedApplication';
import { CosmosAllVersionsChangeFeedBatch } from './CosmosAllVersionsChangeFeedBatch';
import { CosmosChangeFeedItem } from './CosmosChangeFeedItem';
import { CosmosChangeType } from './CosmosChangeType';
import { ICosmosChangeFeedProcessorFactory } from './ICosmosChangeFeedProcessorFactory';

/**
 * A long-running worker that consumes a Cosmos DB container's change feed in
 * *all-versions-and-deletes* mode and runs each delivered batch through a Benzene streaming pipeline of
 * {@link CosmosChangeFeedItem} (current + previous + change type). The sibling of
 * {@link BenzeneCosmosChangeFeedWorker} for the mode where deletes and intermediate versions surface
 * (requires caller-configured container/account retention).
 *
 * The all-versions-and-deletes path is *automatic-checkpoint only* — it checkpoints after the change
 * handler returns successfully — so, unlike the manual-checkpoint sibling, there is no per-batch
 * checkpointer and no auto-checkpoint knob. The only failure decision is
 * {@link BenzeneCosmosAllVersionsChangeFeedConfig.catchHandlerExceptions}: swallow (checkpoint
 * advances, poison batch skipped) or rethrow (no checkpoint, batch redelivered — the default,
 * at-least-once).
 *
 * @typeParam TDocument The document type the change items are deserialized into.
 */
export class BenzeneCosmosAllVersionsChangeFeedWorker<TDocument> implements IBenzeneWorker {
  private processor: ChangeFeedProcessor | undefined;

  constructor(
    private readonly serviceResolverFactory: IServiceResolverFactory,
    private readonly application: CosmosAllVersionsChangeFeedApplication<TDocument>,
    private readonly config: BenzeneCosmosAllVersionsChangeFeedConfig,
    private readonly processorFactory: ICosmosChangeFeedProcessorFactory<TDocument>,
  ) {}

  /** Creates the all-versions processor and starts it, returning once it is running. */
  async startAsync(_cancellationToken?: AbortSignal): Promise<void> {
    this.processor = this.processorFactory.createAllVersionsAndDeletes(
      (context, changes, cancellationToken) => this.onChangesAsync(context, changes, cancellationToken),
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
    changes: readonly ChangeFeedItem<TDocument>[],
    cancellationToken: AbortSignal | undefined,
  ): Promise<void> {
    try {
      // Map inside the try: a mapping failure is a batch that can never succeed, so under skip mode it
      // must still be checkpointed-and-skipped rather than escaping and redelivering forever.
      const items = changes.map((change) => BenzeneCosmosAllVersionsChangeFeedWorker.map(change));
      const batch = new CosmosAllVersionsChangeFeedBatch<TDocument>(
        items,
        context.leaseToken,
        cancellationToken,
      );
      await this.application.handleAsync(batch, this.serviceResolverFactory);
      // Automatic-checkpoint mode: returning here lets the processor checkpoint this batch.
    } catch (error) {
      if (cancellationToken?.aborted === true && this.isCancellation(error)) {
        // Shutdown cancelled the batch mid-flight. Even in skip mode, do NOT swallow this: returning
        // normally would let the automatic-checkpoint processor checkpoint a partially-processed batch,
        // silently losing the unprocessed tail. Propagate so the batch is redelivered.
        throw error;
      }

      this.logError(
        error,
        `Processing all-versions change feed batch of ${changes.length} changes on lease ${context.leaseToken} failed`,
      );

      if (!this.config.catchHandlerExceptions) {
        // Retry mode (default): let the exception reach the processor — it does not checkpoint, so the
        // same batch is redelivered (at-least-once).
        throw error;
      }

      // Skip mode: swallow so the processor checkpoints and the poison batch is passed over.
    }
  }

  private static map<TDocument>(item: ChangeFeedItem<TDocument>): CosmosChangeFeedItem<TDocument> {
    return new CosmosChangeFeedItem<TDocument>(
      item.current,
      item.previous,
      BenzeneCosmosAllVersionsChangeFeedWorker.mapChangeType(item.metadata.operationType),
    );
  }

  private static mapChangeType(operationType: string): CosmosChangeType {
    switch (operationType) {
      case ChangeFeedOperationType.Create:
        return CosmosChangeType.Create;
      case ChangeFeedOperationType.Delete:
        return CosmosChangeType.Delete;
      default:
        return CosmosChangeType.Replace;
    }
  }

  private onErrorAsync(leaseToken: string, exception: unknown): Promise<void> {
    this.logError(exception, `All-versions change feed processing failed on lease ${leaseToken}`);
    return Promise.resolve();
  }

  private isCancellation(error: unknown): boolean {
    const name = (error as { name?: unknown } | null | undefined)?.name;
    return name === 'AbortError' || name === 'OperationCanceledError';
  }

  private logError(error: unknown, messageText: string): void {
    const loggingScope = this.serviceResolverFactory.createScope();
    try {
      const logger =
        loggingScope
          .tryGetService(ILoggerFactory)
          ?.createLogger('BenzeneCosmosAllVersionsChangeFeedWorker') ?? NullLogger.instance;
      logger.logError(error, messageText);
    } finally {
      loggingScope.dispose();
    }
  }
}

/** Port of Benzene.Azure.CosmosDb.CosmosAllVersionsChangeFeedApplication. */
import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { TransportNames } from '@benzene/abstractions-message-handlers';
import { TransportMiddlewarePipeline } from '@benzene/core-message-handlers';
import { StreamContext, StreamMiddlewareApplication } from '@benzene/core-middleware';
import { CosmosAllVersionsChangeFeedBatch } from './CosmosAllVersionsChangeFeedBatch';
import { CosmosChangeFeedItem } from './CosmosChangeFeedItem';

/**
 * Runs an all-versions-and-deletes change feed batch through the streaming pipeline as a single
 * {@link StreamContext} of {@link CosmosChangeFeedItem} (fan-in) — the same shape as
 * {@link CosmosChangeFeedApplication} but over change items (current + previous + change type) rather
 * than bare documents, and with *no* checkpointer: the all-versions-and-deletes path is
 * automatic-checkpoint only, so the context uses the default `NullStreamCheckpointer` and progress is
 * advanced by the handler returning without throwing.
 *
 * @typeParam TDocument The document type the change items are deserialized into.
 */
export class CosmosAllVersionsChangeFeedApplication<TDocument> extends StreamMiddlewareApplication<
  CosmosAllVersionsChangeFeedBatch<TDocument>,
  CosmosChangeFeedItem<TDocument>
> {
  /**
   * The {@link StreamContext.metadata} key holding the batch's lease token (the partition key range the
   * batch was read from).
   */
  static readonly LeaseTokenMetadataKey = 'cosmosDb.leaseToken';

  constructor(pipeline: IMiddlewarePipeline<StreamContext<CosmosChangeFeedItem<TDocument>>>) {
    super(
      new TransportMiddlewarePipeline<StreamContext<CosmosChangeFeedItem<TDocument>>>(
        TransportNames.CosmosDb,
        pipeline,
      ),
      CosmosAllVersionsChangeFeedApplication.buildContext,
    );
  }

  private static buildContext<TDocument>(
    batch: CosmosAllVersionsChangeFeedBatch<TDocument>,
  ): StreamContext<CosmosChangeFeedItem<TDocument>> {
    return new StreamContext<CosmosChangeFeedItem<TDocument>>(
      CosmosAllVersionsChangeFeedApplication.toAsyncIterable(batch.changes),
      // automatic-checkpoint mode: NullStreamCheckpointer (default), progress rides on success
      undefined,
      batch.cancellationToken,
      { [CosmosAllVersionsChangeFeedApplication.LeaseTokenMetadataKey]: batch.leaseToken },
    );
  }

  private static async *toAsyncIterable<TDocument>(
    changes: readonly CosmosChangeFeedItem<TDocument>[],
  ): AsyncGenerator<CosmosChangeFeedItem<TDocument>> {
    for (const change of changes) {
      yield change;
    }
  }
}

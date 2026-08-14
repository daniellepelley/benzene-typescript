/** Port of Benzene.Azure.CosmosDb.CosmosChangeFeedApplication. */
import { IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { TransportNames } from '@benzenejs/abstractions-message-handlers';
import { TransportMiddlewarePipeline } from '@benzenejs/core-message-handlers';
import { MiddlewareApplicationWithResult, StreamContext } from '@benzenejs/core-middleware';
import { CosmosChangeFeedBatch } from './CosmosChangeFeedBatch';
import { CosmosChangeFeedStreamCheckpointer } from './CosmosChangeFeedStreamCheckpointer';

/**
 * Runs a change feed batch through the streaming pipeline as a single {@link StreamContext} (fan-in):
 * the whole batch is exposed as one ordered `AsyncIterable` of documents, processed by one pipeline run
 * in one DI scope — the same shape as `@benzenejs/azure-function-cosmos-db`'s trigger adapter and AWS's
 * Kinesis stream application. The context is wired with a real batch-level checkpointer (wrapping the
 * batch's checkpoint hook), and `handleAsync` returns whether the handler called it, so
 * {@link BenzeneCosmosChangeFeedWorker} can decide auto-checkpoint behaviour. Unlike Kinesis, a
 * pipeline exception is *not* caught here — the worker owns the catch/skip/retry decision.
 *
 * PORTING NOTE: C# extends `StreamMiddlewareApplication<CosmosChangeFeedBatch<TDocument>, TDocument,
 * bool>` — the result-producing (3-generic) stream application. That 3-generic overload was not part of
 * the TypeScript `@benzenejs/core-middleware` port (only the 2-generic `StreamMiddlewareApplication`), so
 * this composes the ported {@link MiddlewareApplicationWithResult} directly — the exact base the C#
 * 3-generic type reduces to (`MiddlewareApplication<TEvent, StreamContext<TItem>, TResult>`), with the
 * same pipeline + `event → StreamContext` mapper + `StreamContext → result` mapper. See the README
 * "Porting conventions" table.
 *
 * @typeParam TDocument The document type the change feed batches are deserialized into.
 */
export class CosmosChangeFeedApplication<TDocument> extends MiddlewareApplicationWithResult<
  CosmosChangeFeedBatch<TDocument>,
  StreamContext<TDocument>,
  boolean
> {
  /**
   * The {@link StreamContext.metadata} key holding the batch's lease token (the partition key range the
   * batch was read from).
   */
  static readonly LeaseTokenMetadataKey = 'cosmosDb.leaseToken';

  constructor(pipeline: IMiddlewarePipeline<StreamContext<TDocument>>) {
    super(
      new TransportMiddlewarePipeline<StreamContext<TDocument>>(TransportNames.CosmosDb, pipeline),
      CosmosChangeFeedApplication.buildContext,
      (context) =>
        (context.checkpointer as CosmosChangeFeedStreamCheckpointer<TDocument>).hasCheckpointed,
    );
  }

  private static buildContext<TDocument>(
    batch: CosmosChangeFeedBatch<TDocument>,
  ): StreamContext<TDocument> {
    return new StreamContext<TDocument>(
      CosmosChangeFeedApplication.toAsyncIterable(batch.changes),
      new CosmosChangeFeedStreamCheckpointer<TDocument>(batch.checkpointAsync),
      batch.cancellationToken,
      { [CosmosChangeFeedApplication.LeaseTokenMetadataKey]: batch.leaseToken },
    );
  }

  private static async *toAsyncIterable<TDocument>(
    documents: readonly TDocument[],
  ): AsyncGenerator<TDocument> {
    for (const document of documents) {
      yield document;
    }
  }
}

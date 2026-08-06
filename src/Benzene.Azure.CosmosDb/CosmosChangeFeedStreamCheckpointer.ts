/** Port of Benzene.Azure.CosmosDb.CosmosChangeFeedStreamCheckpointer. */
import { IStreamCheckpointer } from '@benzene/core-middleware';

/**
 * The change feed's {@link IStreamCheckpointer}: wraps the batch-level manual checkpoint hook. The
 * change feed has no per-document resume token, so the `lastProcessed` item is ignored — any call
 * checkpoints the *whole delivered batch* as a unit (in the pull-model port, by persisting the batch's
 * continuation token). A handler wanting finer-grained safety must therefore only call this once
 * everything in the batch it cares about is safe, and do its own within-batch bookkeeping otherwise —
 * the same coarse granularity documented for the Event Hubs Functions trigger.
 *
 * PORTING NOTE: internal in C#; TypeScript has no `internal`, so it is exported (as
 * {@link CosmosChangeFeedApplication} reads {@link hasCheckpointed} off the context's checkpointer),
 * but it is not part of the intended public surface.
 *
 * @typeParam TDocument The document type flowing through the stream.
 */
export class CosmosChangeFeedStreamCheckpointer<TDocument> implements IStreamCheckpointer<TDocument> {
  private readonly checkpointAsyncHook: () => Promise<void>;

  /** Whether the handler has checkpointed this batch. */
  private checkpointed = false;

  constructor(checkpointAsync: () => Promise<void>) {
    this.checkpointAsyncHook = checkpointAsync;
  }

  /** Whether the handler has checkpointed this batch. */
  get hasCheckpointed(): boolean {
    return this.checkpointed;
  }

  async checkpointAsync(_lastProcessed: TDocument): Promise<void> {
    await this.checkpointAsyncHook();
    this.checkpointed = true;
  }
}

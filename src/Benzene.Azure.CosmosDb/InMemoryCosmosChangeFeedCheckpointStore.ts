/**
 * A reference/dev {@link ICosmosChangeFeedCheckpointStore} that keeps continuation tokens in a plain
 * in-process `Map`.
 *
 * TypeScript-only addition (no C# counterpart): the .NET package needs no such thing because the .NET
 * Change Feed Processor persists its checkpoint automatically in its lease container — the store seam
 * exists in this port only because the pull-model fork (see the README "Porting conventions"
 * change-feed-processor fork note) hands checkpoint persistence back to the caller. This package ships
 * no *durable* store — a production worker supplies its own, backed by a Cosmos container, blob, table,
 * etc. — so this in-memory implementation is provided as a batteries-included reference for tests,
 * local development, and worked examples, keeping the common case copy-paste-runnable.
 *
 * NOT DURABLE: tokens live only for the lifetime of the process. On restart the store is empty, so the
 * worker resumes from its configured `startFrom` (default "now") rather than the last processed change —
 * i.e. it does not survive a restart. Use a persistent store for anything that must not miss changes
 * across restarts.
 */
import { ICosmosChangeFeedCheckpointStore } from './ChangeFeedProcessor';

export class InMemoryCosmosChangeFeedCheckpointStore implements ICosmosChangeFeedCheckpointStore {
  private readonly tokens = new Map<string, string>();

  /** Reads the persisted continuation token for `leaseToken`, or `undefined` when none has been written. */
  readContinuationToken(leaseToken: string): Promise<string | undefined> {
    return Promise.resolve(this.tokens.get(leaseToken));
  }

  /** Persists `continuationToken` as the checkpoint for `leaseToken`, overwriting any previous value. */
  writeContinuationToken(leaseToken: string, continuationToken: string): Promise<void> {
    this.tokens.set(leaseToken, continuationToken);
    return Promise.resolve();
  }
}

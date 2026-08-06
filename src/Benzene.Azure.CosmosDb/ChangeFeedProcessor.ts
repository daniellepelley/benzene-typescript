/**
 * Port of the Microsoft.Azure.Cosmos change-feed-processor seams the C# worker consumes
 * (`ChangeFeedProcessor`, `ChangeFeedProcessorContext`, the `Container.ChangeFeed*` delegate types,
 * and `ChangeFeedItem<T>`/`ChangeFeedOperationType`).
 *
 * THE CHANGE-FEED-PROCESSOR FORK. The .NET `Microsoft.Azure.Cosmos` SDK ships a **push-model**
 * `ChangeFeedProcessor` with automatic lease/checkpoint management (a lease container, cross-instance
 * load balancing, batch-level manual-checkpoint hooks). `@azure/cosmos` has **no** such processor — it
 * offers only a **pull-model** iterator (`container.items.getChangeFeedIterator(...)` with
 * `ChangeFeedStartFrom`/`ChangeFeedMode` and continuation tokens). So none of these SDK types exist in
 * the JS SDK; this package defines the equivalents itself and {@link CosmosChangeFeedProcessorFactory}
 * realizes the "processor" by driving the pull iterator in a poll loop, persisting the continuation
 * token as the checkpoint. See the README "Porting conventions" table for the full deviation note.
 */

/**
 * Port of `Microsoft.Azure.Cosmos.ChangeFeedProcessorContext`. The per-delivery context handed to a
 * change handler; the port surfaces only the lease token the worker uses.
 */
export interface ChangeFeedProcessorContext {
  /** The lease (partition key range) the batch was read from. */
  readonly leaseToken: string;
}

/**
 * Port of `Microsoft.Azure.Cosmos.ChangeFeedProcessor`. A started/stoppable processor. The C# SDK's
 * `StartAsync`/`StopAsync` take no cancellation token, so — matching the C# worker — the host's tokens
 * are not observed here either.
 */
export interface ChangeFeedProcessor {
  /** Starts consuming; returns once running (it does not block until shutdown). */
  startAsync(): Promise<void>;
  /** Stops consuming, waiting for the in-flight batch handler to finish. */
  stopAsync(): Promise<void>;
}

/**
 * Port of `Container.ChangeFeedHandlerWithManualCheckpoint<TDocument>`: the worker's batch handler for
 * the manual-checkpoint (latest-version) path, including its checkpoint hook.
 */
export type ChangeFeedHandlerWithManualCheckpoint<TDocument> = (
  context: ChangeFeedProcessorContext,
  changes: readonly TDocument[],
  checkpointAsync: () => Promise<void>,
  cancellationToken: AbortSignal | undefined,
) => Promise<void>;

/**
 * Port of `Container.ChangeFeedHandler<T>`: the worker's batch handler for the automatic-checkpoint
 * (all-versions-and-deletes) path — no checkpoint hook.
 */
export type ChangeFeedHandler<TItem> = (
  context: ChangeFeedProcessorContext,
  changes: readonly TItem[],
  cancellationToken: AbortSignal | undefined,
) => Promise<void>;

/** Port of `Container.ChangeFeedMonitorErrorDelegate`: the worker's error handler for lease/processing failures. */
export type ChangeFeedMonitorErrorDelegate = (leaseToken: string, exception: unknown) => Promise<void>;

/**
 * The change feed's operation type, as carried in an all-versions-and-deletes item's metadata. Port of
 * `Microsoft.Azure.Cosmos.ChangeFeedOperationType`, whose members map to the full-fidelity wire values
 * (`"create"`, `"replace"`, `"delete"`) the pull iterator returns.
 */
export const ChangeFeedOperationType = {
  Create: 'create',
  Replace: 'replace',
  Delete: 'delete',
} as const;

export type ChangeFeedOperationType =
  (typeof ChangeFeedOperationType)[keyof typeof ChangeFeedOperationType];

/**
 * Port of `Microsoft.Azure.Cosmos.ChangeFeedItem<T>`: one raw all-versions-and-deletes item as the
 * pull iterator returns it — the document's state after the change ({@link current}), its state before
 * ({@link previous}, when retention captured it), and {@link metadata}. `@azure/cosmos` returns these
 * untyped (the developer supplies the element type of `getChangeFeedIterator<T>`), so this package
 * declares the shape the full-fidelity wire format uses. {@link BenzeneCosmosAllVersionsChangeFeedWorker}
 * maps each of these into a Benzene-owned {@link CosmosChangeFeedItem}.
 */
export interface ChangeFeedItem<TDocument> {
  /** The document's state after the change (the tombstone for a delete). */
  current: TDocument;
  /** The document's state before the change, when retention captured it; otherwise `undefined`. */
  previous?: TDocument;
  /** The change metadata, including the operation type. */
  metadata: ChangeFeedMetadata;
}

/** Port of `Microsoft.Azure.Cosmos.ChangeFeedMetadata` (the part the worker reads). */
export interface ChangeFeedMetadata {
  /** The kind of operation the change represents. */
  operationType: ChangeFeedOperationType | string;
}

/**
 * Where a change-feed processor persists (and resumes) its continuation-token checkpoint. In the .NET
 * SDK this is the automatic lease container; the JS pull iterator has no lease/checkpoint store, so
 * the caller supplies one (backed by a Cosmos container, blob, table, ...) and
 * {@link CosmosChangeFeedProcessorFactory} reads/writes the continuation token through it. Keyed by
 * lease token so a future feed-range-partitioned implementation can persist one token per range.
 */
export interface ICosmosChangeFeedCheckpointStore {
  /** Reads the persisted continuation token for `leaseToken`, or `undefined` to start fresh. */
  readContinuationToken(leaseToken: string): Promise<string | undefined>;
  /** Persists `continuationToken` as the checkpoint for `leaseToken`. */
  writeContinuationToken(leaseToken: string, continuationToken: string): Promise<void>;
}

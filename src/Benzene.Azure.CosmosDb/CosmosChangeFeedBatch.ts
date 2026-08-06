/** Port of Benzene.Azure.CosmosDb.CosmosChangeFeedBatch. */

/**
 * One delivered change feed batch: the raw event {@link CosmosChangeFeedApplication} maps into a
 * `StreamContext<TDocument>`. Carries the batch's documents together with the batch-level manual
 * checkpoint hook and lease identity — the change feed has no per-document resume token, so
 * {@link checkpointAsync} acknowledges the whole batch as a unit.
 *
 * Platform mappings: C# `Func<Task>` → `() => Promise<void>`; `CancellationToken` →
 * `AbortSignal | undefined` (the established {@link IBenzeneWorker}/{@link StreamContext} mapping);
 * `IReadOnlyCollection<TDocument>` → `readonly TDocument[]`.
 *
 * @typeParam TDocument The document type the batch was deserialized into.
 */
export class CosmosChangeFeedBatch<TDocument> {
  /** The changed documents, in change feed order for the lease's partition key range. */
  readonly changes: readonly TDocument[];

  /**
   * The batch-level checkpoint hook for this delivery. In the pull-model port this persists the
   * change feed's continuation token as the checkpoint (see the package README's change-feed-processor
   * fork note).
   */
  readonly checkpointAsync: () => Promise<void>;

  /** The lease (partition key range) the batch was read from. */
  readonly leaseToken: string;

  /** The cancellation signal for this delivery. */
  readonly cancellationToken: AbortSignal | undefined;

  /**
   * @param changes The changed documents, in change feed order for the lease's partition key range.
   * @param checkpointAsync The batch-level checkpoint hook for this delivery.
   * @param leaseToken The lease (partition key range) the batch was read from.
   * @param cancellationToken The cancellation signal for this delivery.
   */
  constructor(
    changes: readonly TDocument[],
    checkpointAsync: () => Promise<void>,
    leaseToken: string,
    cancellationToken?: AbortSignal,
  ) {
    this.changes = changes;
    this.checkpointAsync = checkpointAsync;
    this.leaseToken = leaseToken;
    this.cancellationToken = cancellationToken;
  }
}

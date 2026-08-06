/** Port of Benzene.Azure.CosmosDb.CosmosAllVersionsChangeFeedBatch. */
import { CosmosChangeFeedItem } from './CosmosChangeFeedItem';

/**
 * One delivered all-versions-and-deletes change feed batch: the changes (each a
 * {@link CosmosChangeFeedItem} carrying current/previous state and change type), plus the lease
 * identity and cancellation signal. Unlike {@link CosmosChangeFeedBatch}, there is no manual
 * checkpoint hook — the all-versions-and-deletes path is automatic-checkpoint only (it checkpoints
 * after the handler returns successfully), so progress is advanced by the handler completing without
 * throwing rather than by an explicit call.
 *
 * Platform mappings: C# `IReadOnlyCollection<...>` → `readonly ...[]`; `CancellationToken` →
 * `AbortSignal | undefined`.
 *
 * @typeParam TDocument The document type the changes were deserialized into.
 */
export class CosmosAllVersionsChangeFeedBatch<TDocument> {
  /** The changes, in change feed order for the lease's partition key range. */
  readonly changes: readonly CosmosChangeFeedItem<TDocument>[];

  /** The lease (partition key range) the batch was read from. */
  readonly leaseToken: string;

  /** The cancellation signal for this delivery. */
  readonly cancellationToken: AbortSignal | undefined;

  /**
   * @param changes The changes, in change feed order for the lease's partition key range.
   * @param leaseToken The lease (partition key range) the batch was read from.
   * @param cancellationToken The cancellation signal for this delivery.
   */
  constructor(
    changes: readonly CosmosChangeFeedItem<TDocument>[],
    leaseToken: string,
    cancellationToken?: AbortSignal,
  ) {
    this.changes = changes;
    this.leaseToken = leaseToken;
    this.cancellationToken = cancellationToken;
  }
}

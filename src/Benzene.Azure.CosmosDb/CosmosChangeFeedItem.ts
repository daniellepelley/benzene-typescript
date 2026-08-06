/** Port of Benzene.Azure.CosmosDb.CosmosChangeFeedItem. */
import { CosmosChangeType } from './CosmosChangeType';

/**
 * One change surfaced by the change feed's *all-versions-and-deletes* mode: the document's state after
 * the change ({@link current}), its state before ({@link previous}, when the account/container
 * retention captures it), and the {@link changeType}. A Benzene-owned projection of the raw
 * change-feed item so handlers stream a plain Benzene type.
 *
 * For a {@link CosmosChangeType.Delete}, {@link current} is typically the tombstone (id/partition-key
 * only or default) and the meaningful prior state, if retained, is in {@link previous}. For
 * {@link CosmosChangeType.Create}/{@link CosmosChangeType.Replace}, {@link current} is the changed
 * document. All-versions-and-deletes requires the caller to have configured container/account
 * retention; without it, deletes and intermediate versions don't surface.
 *
 * Platform mapping: C# `TDocument previous` (which may be `default`/`null`) → `TDocument | undefined`.
 *
 * @typeParam TDocument The document type the change feed items are deserialized into.
 */
export class CosmosChangeFeedItem<TDocument> {
  /** The document's state after the change (the tombstone for a delete). */
  readonly current: TDocument;

  /** The document's state before the change, when retention captured it; otherwise `undefined`. */
  readonly previous: TDocument | undefined;

  /** The kind of change (create, replace, or delete). */
  readonly changeType: CosmosChangeType;

  /**
   * @param current The document's state after the change.
   * @param previous The document's state before the change, if retained; otherwise `undefined`.
   * @param changeType The kind of change.
   */
  constructor(current: TDocument, previous: TDocument | undefined, changeType: CosmosChangeType) {
    this.current = current;
    this.previous = previous;
    this.changeType = changeType;
  }
}

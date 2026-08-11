/** One item of a batch paired with its zero-based index in the original request collection. */
export interface IndexedItem<T> {
  readonly item: T;
  readonly index: number;
}

/**
 * Shared helper for `IBenzeneBatchMessageClient` implementations: splits a request collection into
 * provider-sized chunks while carrying each item's original index, so per-entry failures can be reported
 * back against the caller's collection. Port of Benzene.Clients.BatchSend.
 */
export const BatchSend = {
  /**
   * Splits `items` into chunks of at most `chunkSize`, pairing each item with its zero-based index in
   * `items`.
   *
   * @param items The items to chunk, in order.
   * @param chunkSize The maximum chunk size (the provider's per-batch limit).
   * @returns The chunks, each a list of (item, original index) pairs.
   */
  chunk<T>(items: readonly T[], chunkSize: number): IndexedItem<T>[][] {
    const chunks: IndexedItem<T>[][] = [];
    let current: IndexedItem<T>[] = [];
    items.forEach((item, index) => {
      current.push({ item, index });
      if (current.length === chunkSize) {
        chunks.push(current);
        current = [];
      }
    });
    if (current.length > 0) {
      chunks.push(current);
    }
    return chunks;
  },
};

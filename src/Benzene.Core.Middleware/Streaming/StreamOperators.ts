/**
 * Port of Benzene.Core.Middleware.StreamOperators.
 *
 * Composable operators over an `AsyncIterable<TItem>` stream, for use inside a `useStream(...)`
 * step. Implemented as async-iterable transforms (`async function*`, rather than middleware) so
 * they compose with pipeline-style processing and stay independent of any transport — the natural
 * shape for stream processing.
 *
 * Platform mappings (mirroring the rest of the streaming port):
 * - `IAsyncEnumerable<T>` → `AsyncIterable<T>`; C# `async IAsyncEnumerable<T>` iterator methods →
 *   `async function*` generators. Consumers use `for await (const x of ...)`.
 * - `CancellationToken` → `AbortSignal | undefined`. Where C# enumerates
 *   `source.WithCancellation(token)` (which observes cancellation each step), each loop calls
 *   `signal?.throwIfAborted()` — the idiomatic Node equivalent of `OperationCanceledException`.
 * - `IReadOnlyList<TItem>` → `readonly TItem[]`.
 * - `KeyValuePair<TKey, IReadOnlyList<TItem>>` → `{ key, value }` object, chosen over a tuple so the
 *   `.key` / `.value` members mirror C# `KeyValuePair`'s `.Key` / `.Value` shape one-for-one.
 *
 * C# extension methods → free functions taking the source stream as the first argument.
 */

/** A (key, ordered items) pairing, mirroring C# `KeyValuePair<TKey, IReadOnlyList<TItem>>`. */
export interface Partition<TKey, TItem> {
  readonly key: TKey;
  readonly value: readonly TItem[];
}

/**
 * Batches the stream into fixed-size windows. The final window may be smaller than `size`. Order is
 * preserved. This is the building block for batch aggregation — e.g. writing one database round-trip
 * per window instead of one per item.
 *
 * @typeParam TItem The item type.
 * @param source The source stream.
 * @param size The maximum number of items per window (must be at least 1).
 * @param signal Cancellation for the enumeration.
 * @returns A stream of windows, each a read-only array of up to `size` items.
 */
export async function* window<TItem>(
  source: AsyncIterable<TItem>,
  size: number,
  signal?: AbortSignal,
): AsyncIterable<readonly TItem[]> {
  if (size < 1) {
    throw new RangeError('Window size must be at least 1.');
  }

  let currentWindow: TItem[] = [];

  for await (const item of source) {
    signal?.throwIfAborted();
    currentWindow.push(item);

    if (currentWindow.length === size) {
      yield currentWindow;
      currentWindow = [];
    }
  }

  if (currentWindow.length > 0) {
    yield currentWindow;
  }
}

/**
 * Groups the stream into per-key sub-streams, preserving item order within each key and yielding
 * keys in the order they were first seen. Use this to restore per-partition ordering that the
 * concurrent fan-out model loses — e.g. `partitionBy(source, e => e.partitionId)`.
 *
 * Buffers the whole stream to group it, so it's suited to bounded batches (the typical Event
 * Hubs / SQS / Kafka trigger batch), not unbounded infinite streams.
 *
 * @typeParam TItem The item type.
 * @typeParam TKey The partition key type.
 * @param source The source stream.
 * @param keySelector Selects the partition key for an item.
 * @param signal Cancellation for the enumeration.
 * @returns A stream of (key, ordered items) pairs, keys in first-seen order.
 */
export async function* partitionBy<TItem, TKey>(
  source: AsyncIterable<TItem>,
  keySelector: (item: TItem) => TKey,
  signal?: AbortSignal,
): AsyncIterable<Partition<TKey, TItem>> {
  const groups = new Map<TKey, TItem[]>();
  const order: TKey[] = [];

  for await (const item of source) {
    signal?.throwIfAborted();
    const key = keySelector(item);

    let items = groups.get(key);
    if (items === undefined) {
      items = [];
      groups.set(key, items);
      order.push(key);
    }

    items.push(item);
  }

  for (const key of order) {
    yield { key, value: groups.get(key)! };
  }
}

import { describe, expect, it } from 'vitest';
import { partitionBy, window } from '@benzene/core-middleware';

/**
 * Port of Benzene.Test.Core.Middleware.Streaming.StreamOperatorsTest
 * (test/Benzene.Core.Test/Core/Middleware/Streaming/StreamOperatorsTest.cs).
 *
 * The C# `ToAsyncEnumerable` helper maps to an `async function*`; `Window`/`PartitionBy` extension
 * methods map to the ported `window`/`partitionBy` free functions.
 */

async function* toAsyncIterable<T>(items: readonly T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of source) {
    result.push(item);
  }
  return result;
}

describe('StreamOperatorsTest', () => {
  it('Window_BatchesIntoFixedSizeWindows_WithASmallerFinalWindow', async () => {
    const windows = await collect(window(toAsyncIterable([1, 2, 3, 4, 5]), 2));

    expect(windows).toHaveLength(3);
    expect(windows[0]).toEqual([1, 2]);
    expect(windows[1]).toEqual([3, 4]);
    expect(windows[2]).toEqual([5]);
  });

  it('Window_WithExactMultiple_ProducesNoTrailingWindow', async () => {
    const windows = await collect(window(toAsyncIterable([1, 2, 3, 4]), 2));

    expect(windows).toHaveLength(2);
    for (const w of windows) {
      expect(w).toHaveLength(2);
    }
  });

  it('Window_SizeLessThanOne_Throws', async () => {
    await expect(collect(window(toAsyncIterable([1]), 0))).rejects.toThrow(RangeError);
  });

  it('PartitionBy_GroupsByKey_PreservingOrderWithinAndAcrossKeys', async () => {
    const events = [
      { partition: 'a', value: 1 },
      { partition: 'b', value: 2 },
      { partition: 'a', value: 3 },
      { partition: 'b', value: 4 },
      { partition: 'a', value: 5 },
    ];

    const partitions = await collect(partitionBy(toAsyncIterable(events), (e) => e.partition));

    // Keys in first-seen order: "a" then "b".
    expect(partitions.map((p) => p.key)).toEqual(['a', 'b']);
    // Order preserved within each key.
    expect(partitions[0]!.value.map((e) => e.value)).toEqual([1, 3, 5]);
    expect(partitions[1]!.value.map((e) => e.value)).toEqual([2, 4]);
  });
});

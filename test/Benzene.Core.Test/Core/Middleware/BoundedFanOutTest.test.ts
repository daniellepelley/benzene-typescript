import { describe, expect, it } from 'vitest';
import { BoundedFanOut } from '@benzene/core-middleware';

/** Unit test for the BoundedFanOut primitive (new in the port; the C# suite exercises it via batch apps). */
describe('BoundedFanOut', () => {
  it('unbounded runs everything and returns results in source order', async () => {
    const results = await BoundedFanOut.whenAllAsync([1, 2, 3], (x) => Promise.resolve(x * 2), undefined);
    expect(results).toEqual([2, 4, 6]);
  });

  it('bounded caps concurrency and preserves source order', async () => {
    let live = 0;
    let maxLive = 0;

    const results = await BoundedFanOut.whenAllAsync(
      [1, 2, 3, 4, 5],
      async (x) => {
        live += 1;
        maxLive = Math.max(maxLive, live);
        await new Promise((resolve) => setTimeout(resolve, 5));
        live -= 1;
        return x;
      },
      2,
    );

    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(maxLive).toBeLessThanOrEqual(2); // never more than the configured ceiling in flight
  });

  it('isBounded treats undefined and non-positive as unbounded', () => {
    expect(BoundedFanOut.isBounded(undefined)).toBe(false);
    expect(BoundedFanOut.isBounded(0)).toBe(false);
    expect(BoundedFanOut.isBounded(-1)).toBe(false);
    expect(BoundedFanOut.isBounded(3)).toBe(true);
  });
});

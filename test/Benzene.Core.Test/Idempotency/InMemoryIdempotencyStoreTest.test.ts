import { describe, expect, it } from 'vitest';
import { IdempotencyStatus, InMemoryIdempotencyStore } from '@benzene/idempotency';

/** Port of test/Benzene.Core.Test/Idempotency/InMemoryIdempotencyStoreTest.cs. */
describe('InMemoryIdempotencyStore', () => {
  it('the first claim of a key wins', async () => {
    const store = new InMemoryIdempotencyStore();

    const claim = await store.tryClaimAsync('key-1');

    expect(claim.claimed).toBe(true);
    expect(claim.existingRecord).toBeUndefined();
  });

  it('a second claim while in progress is refused with an in-progress record', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.tryClaimAsync('key-1');

    const claim = await store.tryClaimAsync('key-1');

    expect(claim.claimed).toBe(false);
    expect(claim.existingRecord).toBeDefined();
    expect(claim.existingRecord!.status).toBe(IdempotencyStatus.InProgress);
  });

  it('a claim after completion is refused with the completed outcome', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.tryClaimAsync('key-1');
    await store.completeAsync('key-1', true);

    const claim = await store.tryClaimAsync('key-1');

    expect(claim.claimed).toBe(false);
    expect(claim.existingRecord!.status).toBe(IdempotencyStatus.Completed);
    expect(claim.existingRecord!.wasSuccessful).toBe(true);
  });

  it('release allows reclaim', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.tryClaimAsync('key-1');

    await store.releaseAsync('key-1');
    const claim = await store.tryClaimAsync('key-1');

    expect(claim.claimed).toBe(true);
  });

  it('a claim after TTL expiry allows reclaim', async () => {
    let now = 1_000_000;
    const store = new InMemoryIdempotencyStore(10 * 60 * 1000, () => now);
    await store.tryClaimAsync('key-1');

    // A duplicate within the TTL is still refused...
    expect((await store.tryClaimAsync('key-1')).claimed).toBe(false);

    // ...but once the record has expired, the key can be claimed again.
    now += 11 * 60 * 1000;
    expect((await store.tryClaimAsync('key-1')).claimed).toBe(true);
  });

  it('different keys are independent', async () => {
    const store = new InMemoryIdempotencyStore();

    expect((await store.tryClaimAsync('key-a')).claimed).toBe(true);
    expect((await store.tryClaimAsync('key-b')).claimed).toBe(true);
  });

  it('tryClaim with an already-aborted signal throws', async () => {
    const store = new InMemoryIdempotencyStore();

    await expect(store.tryClaimAsync('key-1', AbortSignal.abort())).rejects.toThrow();
  });

  it('complete and release with an already-aborted signal throw', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.tryClaimAsync('key-1');

    await expect(store.completeAsync('key-1', true, AbortSignal.abort())).rejects.toThrow();
    await expect(store.releaseAsync('key-1', AbortSignal.abort())).rejects.toThrow();
  });
});

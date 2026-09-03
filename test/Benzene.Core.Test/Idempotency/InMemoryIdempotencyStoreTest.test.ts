import { describe, expect, it } from 'vitest';
import { IdempotencyStatus, InMemoryIdempotencyStore } from '@benzenejs/idempotency';

/** Port of test/Benzene.Core.Test/Idempotency/InMemoryIdempotencyStoreTest.cs. */
describe('InMemoryIdempotencyStore', () => {
  it('the first claim of a key wins and mints a claim token', async () => {
    const store = new InMemoryIdempotencyStore();

    const claim = await store.tryClaimAsync('key-1');

    expect(claim.claimed).toBe(true);
    expect(claim.existingRecord).toBeUndefined();
    expect(claim.claimToken).toBeDefined();
  });

  it('a second claim while in progress is refused with an in-progress record and no token', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.tryClaimAsync('key-1');

    const claim = await store.tryClaimAsync('key-1');

    expect(claim.claimed).toBe(false);
    expect(claim.existingRecord).toBeDefined();
    expect(claim.existingRecord!.status).toBe(IdempotencyStatus.InProgress);
    expect(claim.claimToken).toBeUndefined();
  });

  it('a claim after completion is refused with the completed outcome', async () => {
    const store = new InMemoryIdempotencyStore();
    const claim = await store.tryClaimAsync('key-1');
    await store.completeAsync('key-1', claim.claimToken!, true);

    const reclaim = await store.tryClaimAsync('key-1');

    expect(reclaim.claimed).toBe(false);
    expect(reclaim.existingRecord!.status).toBe(IdempotencyStatus.Completed);
    expect(reclaim.existingRecord!.wasSuccessful).toBe(true);
  });

  it('complete with a matching token succeeds', async () => {
    const store = new InMemoryIdempotencyStore();
    const claim = await store.tryClaimAsync('key-1');

    const settled = await store.completeAsync('key-1', claim.claimToken!, true);

    expect(settled).toBe(true);
  });

  it('complete with a stale token is refused and does not clobber the live claim', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.tryClaimAsync('key-1');

    const settled = await store.completeAsync('key-1', 'not-the-real-token', true);

    expect(settled).toBe(false);
    // The live claim (still in progress under its real token) was not touched.
    const reclaim = await store.tryClaimAsync('key-1');
    expect(reclaim.claimed).toBe(false);
    expect(reclaim.existingRecord!.status).toBe(IdempotencyStatus.InProgress);
  });

  it('release allows reclaim', async () => {
    const store = new InMemoryIdempotencyStore();
    const firstClaim = await store.tryClaimAsync('key-1');

    await store.releaseAsync('key-1', firstClaim.claimToken!);
    const claim = await store.tryClaimAsync('key-1');

    expect(claim.claimed).toBe(true);
  });

  it('release with a stale token is refused and does not remove the live claim', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.tryClaimAsync('key-1');

    const released = await store.releaseAsync('key-1', 'not-the-real-token');

    expect(released).toBe(false);
    const reclaim = await store.tryClaimAsync('key-1');
    expect(reclaim.claimed).toBe(false);
  });

  /**
   * The fenced-settle scenario the tokens exist for: a stale/slow holder's claim naturally lapses
   * (TTL) and a second worker reclaims the key before the first worker's late complete/release
   * arrives. The stale writes must be rejected (return false) and must not clobber the new holder's
   * own claim/outcome.
   */
  it('a stale holder’s late complete and release after a legitimate reclaim are rejected, not clobbered', async () => {
    let now = 1_000_000;
    const store = new InMemoryIdempotencyStore(60 * 1000, () => now);

    // Worker A claims the key.
    const claimA = await store.tryClaimAsync('key-1');
    expect(claimA.claimed).toBe(true);

    // Worker A stalls past the TTL - its claim legitimately lapses.
    now += 2 * 60 * 1000;

    // Worker B reclaims the same key (a fresh claim, a new token).
    const claimB = await store.tryClaimAsync('key-1');
    expect(claimB.claimed).toBe(true);
    expect(claimB.claimToken).not.toBe(claimA.claimToken);

    // Worker A, unaware it lost the claim, now tries to settle with its stale token.
    expect(await store.completeAsync('key-1', claimA.claimToken!, true)).toBe(false);
    expect(await store.releaseAsync('key-1', claimA.claimToken!)).toBe(false);

    // Worker B's own claim is untouched by A's stale writes - it can still settle successfully.
    expect(await store.completeAsync('key-1', claimB.claimToken!, true)).toBe(true);

    const final = await store.tryClaimAsync('key-1');
    expect(final.claimed).toBe(false);
    expect(final.existingRecord!.status).toBe(IdempotencyStatus.Completed);
    expect(final.existingRecord!.wasSuccessful).toBe(true);
  });

  /**
   * The C# #51 rule: fencing is token match ALONE, not token-match-and-unexpired. A holder whose own
   * TTL lapsed with nobody having reclaimed the key is still the only claimant on record, and its
   * settle with the original token must succeed rather than being refused with a misleading
   * "reclaimed by another worker" outcome.
   */
  it('complete with the original token after its own TTL expiry, with no competing claimant, succeeds', async () => {
    let now = 1_000_000;
    const store = new InMemoryIdempotencyStore(60 * 1000, () => now);

    const claim = await store.tryClaimAsync('key-1');
    expect(claim.claimed).toBe(true);

    // The claim's own TTL lapses, but nobody else has reclaimed the key - claim.claimToken is still
    // the only, still-InProgress token on record.
    now += 2 * 60 * 1000;

    const settled = await store.completeAsync('key-1', claim.claimToken!, true);

    expect(settled).toBe(true);
    const reclaim = await store.tryClaimAsync('key-1');
    expect(reclaim.claimed).toBe(false);
    expect(reclaim.existingRecord!.status).toBe(IdempotencyStatus.Completed);
    expect(reclaim.existingRecord!.wasSuccessful).toBe(true);
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

  /**
   * Pins the expiry boundary (the .NET #272 rule, `expiresAt <= now` = expired): a record is live
   * strictly BEFORE `expiresAt` and a claim arriving at exactly `expiresAt` must win. Read
   * (`tryClaimAsync`'s liveness check) and write (`expiresAt = now + ttl`) agree on the inclusive
   * boundary, so there is no instant at which a record is neither claimable nor blocking.
   */
  it('a claim at exactly expiresAt wins (inclusive expiry boundary)', async () => {
    let now = 1_000_000;
    const ttl = 10 * 60 * 1000;
    const store = new InMemoryIdempotencyStore(ttl, () => now);
    await store.tryClaimAsync('key-1');

    // One millisecond before the boundary the record is still live...
    now = 1_000_000 + ttl - 1;
    expect((await store.tryClaimAsync('key-1')).claimed).toBe(false);

    // ...and at exactly expiresAt the record has expired and a fresh claim wins.
    now = 1_000_000 + ttl;
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
    const claim = await store.tryClaimAsync('key-1');

    await expect(
      store.completeAsync('key-1', claim.claimToken!, true, AbortSignal.abort()),
    ).rejects.toThrow();
    await expect(
      store.releaseAsync('key-1', claim.claimToken!, AbortSignal.abort()),
    ).rejects.toThrow();
  });
});

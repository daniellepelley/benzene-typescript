import { randomUUID } from 'node:crypto';
import { ClaimResult } from './ClaimResult';
import { IIdempotencyStore } from './IIdempotencyStore';
import { IdempotencyRecord } from './IdempotencyRecord';
import { IdempotencyStatus } from './IdempotencyStatus';

/** How long a record is retained by default: 24 hours, in milliseconds. */
const defaultTimeToLiveMs = 24 * 60 * 60 * 1000;

interface Entry {
  status: IdempotencyStatus;
  wasSuccessful: boolean;
  expiresAt: number;
  claimToken: string | undefined;
}

/**
 * An in-process {@link IIdempotencyStore} backed by a map, suitable for a single worker instance,
 * tests, and local development.
 * Port of Benzene.Idempotency.InMemoryIdempotencyStore.
 *
 * State lives in this process only. In a multi-instance deployment each instance keeps its own map, so
 * a duplicate redelivered to a different instance is NOT de-duplicated - use a shared store (e.g.
 * Redis) there. Records are held for a configurable time-to-live and expired lazily on the next access
 * to a key.
 *
 * Claim fencing: every winning {@link tryClaimAsync} mints a fresh opaque
 * {@link ClaimResult.claimToken}. {@link completeAsync}/{@link releaseAsync} compare the presented
 * token against the live entry and refuse (return `false`, write nothing) when it doesn't match a
 * still-in-progress claim - the case where this caller's claim already lapsed and a different caller
 * won a fresh claim on the same key. This closes the stale-writer-clobbers-the-new-holder hole a bare
 * key-only settle API would have.
 *
 * The C# `lock`-guarded critical sections are dropped: Node runs the synchronous body of each method to
 * completion on a single thread before any other continuation, so the check-and-insert is already
 * atomic with respect to other callers. Times are epoch-millisecond numbers (C# `DateTimeOffset` ->
 * `number`); the clock is injectable for tests.
 */
export class InMemoryIdempotencyStore implements IIdempotencyStore {
  private readonly entries = new Map<string, Entry>();
  private readonly timeToLiveMs: number;
  private readonly now: () => number;

  /**
   * @param timeToLiveMs How long a record is retained, in milliseconds. Defaults to 24 hours.
   * @param now A clock, overridable for tests. Defaults to `Date.now`.
   */
  constructor(timeToLiveMs: number = defaultTimeToLiveMs, now: () => number = () => Date.now()) {
    this.timeToLiveMs = timeToLiveMs;
    this.now = now;
  }

  // The methods are `async` so a synchronous `throwIfAborted()` becomes a rejected promise (the
  // faulted-Task equivalent of C#'s `ThrowIfCancellationRequested`) rather than throwing at the call
  // site before a promise exists.
  async tryClaimAsync(key: string, signal?: AbortSignal): Promise<ClaimResult> {
    signal?.throwIfAborted();

    const now = this.now();
    const existing = this.entries.get(key);
    if (existing !== undefined && existing.expiresAt > now) {
      const record = new IdempotencyRecord(key, existing.status, existing.wasSuccessful);
      return ClaimResult.alreadyExists(record);
    }

    const claimToken = randomUUID();
    this.entries.set(key, {
      status: IdempotencyStatus.InProgress,
      wasSuccessful: false,
      expiresAt: now + this.timeToLiveMs,
      claimToken,
    });
    return ClaimResult.won(claimToken);
  }

  async completeAsync(
    key: string,
    claimToken: string,
    wasSuccessful: boolean,
    signal?: AbortSignal,
  ): Promise<boolean> {
    signal?.throwIfAborted();

    if (!this.isLiveClaim(key, claimToken)) {
      // The claim lapsed and was reclaimed by another worker, or was already settled - refuse the
      // write rather than clobbering whoever holds the claim now.
      return false;
    }

    this.entries.set(key, {
      status: IdempotencyStatus.Completed,
      wasSuccessful,
      expiresAt: this.now() + this.timeToLiveMs,
      claimToken,
    });
    return true;
  }

  async releaseAsync(key: string, claimToken: string, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted();

    if (!this.isLiveClaim(key, claimToken)) {
      return false;
    }

    this.entries.delete(key);
    return true;
  }

  /**
   * Whether `key` currently has a still-{@link IdempotencyStatus.InProgress} claim whose token is
   * `claimToken`.
   *
   * Fencing is by token match alone - this deliberately does NOT also require
   * `entry.expiresAt > now`. A holder that outraces its own TTL but is still the only claimant
   * (nobody has reclaimed the key) must still be able to settle; requiring an unexpired entry too
   * would refuse that legitimate settle with a misleading "reclaimed by another worker" outcome when
   * nothing actually reclaimed it (the C# #51 rule, matching every sibling fencing implementation).
   * Expiry only matters at claim time ({@link tryClaimAsync} decides whether an existing record
   * blocks a new claim); it is not part of what makes a settle call fenced.
   */
  private isLiveClaim(key: string, claimToken: string): boolean {
    const entry = this.entries.get(key);
    return (
      entry !== undefined &&
      entry.status === IdempotencyStatus.InProgress &&
      entry.claimToken === claimToken
    );
  }
}

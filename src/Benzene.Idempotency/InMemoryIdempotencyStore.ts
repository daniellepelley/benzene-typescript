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

    this.entries.set(key, {
      status: IdempotencyStatus.InProgress,
      wasSuccessful: false,
      expiresAt: now + this.timeToLiveMs,
    });
    return ClaimResult.won();
  }

  async completeAsync(key: string, wasSuccessful: boolean, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();

    this.entries.set(key, {
      status: IdempotencyStatus.Completed,
      wasSuccessful,
      expiresAt: this.now() + this.timeToLiveMs,
    });
  }

  async releaseAsync(key: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();

    this.entries.delete(key);
  }
}

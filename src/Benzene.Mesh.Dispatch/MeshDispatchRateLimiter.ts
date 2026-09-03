/** Port of Benzene.Mesh.Dispatch.MeshDispatchRateLimiter. */

/** The result of one {@link MeshDispatchRateLimiter.tryAcquire} — the port of C#'s bool + `out int`. */
export interface TryAcquireResult {
  /** True when the request is permitted. */
  readonly allowed: boolean;

  /** Seconds until the window rolls, when refused; 0 when allowed. */
  readonly retryAfterSeconds: number;
}

interface Window {
  readonly start: number;
  readonly count: number;
}

const MinuteMs = 60_000;

/**
 * A fixed-window request counter, keyed by whatever the caller keys it by (an identity, a target
 * service).
 *
 * **What this actually guarantees, stated plainly.** The counters live in this process. On a
 * serverless host that means *per warm instance*: a cold start resets them, and N concurrent
 * instances keep N independent counts, so the real ceiling is N × the limit with N unbounded by
 * default. Calling this a rate limit without that sentence would be the kind of claim this codebase
 * exists to avoid.
 *
 * It is the right tool anyway, because of what it is for. Every caller that reaches it has already
 * passed the login gate and the CSRF check, so this is not the flood defence — it is the bound on a
 * stuck retry loop, an over-enthusiastic tester, or one compromised session. The *hard* guarantee
 * belongs at the edge, where the gateway counts atomically across every instance.
 *
 * `DateTimeOffset` clock → an epoch-milliseconds `() => number` clock (the port's usual injectable
 * clock shape); C# `TryAcquire(key, limit, out retryAfter)` → {@link TryAcquireResult}.
 */
export class MeshDispatchRateLimiter {
  /**
   * .NET #187b: the threshold that makes tryAcquire self-prune (below). A limiter used without the
   * guard middleware (e.g. `useMeshDispatch` alone, or a caller that constructs its own) would
   * otherwise keep one window per distinct key forever. 512 is comfortably above what a single warm
   * instance sees in normal use, so this rarely fires on the hot path.
   */
  private static readonly PruneThreshold = 512;

  // C# ConcurrentDictionary(OrdinalIgnoreCase) → a Map keyed by the lower-cased key.
  private readonly windows = new Map<string, Window>();
  private readonly clock: () => number;

  /** @param clock Supplies the current time in epoch ms; defaults to `Date.now`. */
  constructor(clock?: () => number) {
    this.clock = clock ?? Date.now;
  }

  /**
   * Counts one request against `key` and reports whether it is within `limit` for the current
   * minute.
   *
   * @param key The bucket — an identity, or a target service. Case-insensitive.
   * @param limit Requests permitted per minute. Zero or less disables the check entirely.
   */
  tryAcquire(key: string, limit: number): TryAcquireResult {
    if (limit <= 0) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    // Opportunistic self-prune (.NET #187b) — runs before growing the map further, so a shared
    // singleton stays leak-safe even in a configuration with no guard middleware calling prune()
    // on its own schedule.
    if (this.windows.size > MeshDispatchRateLimiter.PruneThreshold) {
      this.prune();
    }

    const now = this.clock();
    // The window start is the minute boundary, not the first request's timestamp: a rolling window
    // would need a per-key request log, and the boundary version is the one whose behaviour a
    // reader can predict from the clock on the wall.
    const windowStart = Math.floor(now / MinuteMs) * MinuteMs;

    const normalizedKey = key.toLowerCase();
    const existing = this.windows.get(normalizedKey);
    const window: Window =
      existing !== undefined && existing.start === windowStart
        ? { start: windowStart, count: existing.count + 1 }
        : { start: windowStart, count: 1 };
    this.windows.set(normalizedKey, window);

    if (window.count <= limit) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + MinuteMs - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  /**
   * Drops windows that have rolled. Called opportunistically rather than on a timer — the map is
   * bounded by the number of distinct identities and targets a single warm instance sees, which is
   * small, but an unbounded map on a long-lived host is a leak waiting to be found in production.
   *
   * **.NET #254.** The removal below is a compare-and-remove, not an unconditional delete-by-key:
   * this method decides an entry is stale from an enumeration snapshot; between that read and the
   * removal, a `tryAcquire` for the SAME key can install a fresh, still-current-minute window (in
   * this port that interleaving needs the map to be observed mid-prune — e.g. instrumented in a
   * test, or a future async store — but the C# race was hot-path real, and porting the guard keeps
   * the semantics identical). An unconditional delete would remove whatever is CURRENTLY stored —
   * the concurrently installed fresh window, not the stale value this method reacted to — silently
   * losing that request's charge and letting more than the configured limit through for the rest of
   * the minute. The conditional form compares the stored value against the snapshot before removing,
   * so a stale decision can never delete a value that was replaced — it just leaves the fresh window
   * in place for the next prune to reconsider.
   */
  prune(): void {
    const now = this.clock();
    const cutoff = Math.floor(now / MinuteMs) * MinuteMs;
    for (const [key, window] of [...this.windows.entries()]) {
      if (window.start < cutoff && this.windows.get(key) === window) {
        this.windows.delete(key);
      }
    }
  }
}

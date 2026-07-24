import { MetadataName, RateLimitLease } from './RateLimitLease';
import { acquiredZeroLease, assertPermitCount, RateLimiter } from './RateLimiter';

/** Options for {@link TokenBucketRateLimiter}. Port of `TokenBucketRateLimiterOptions` (the subset used). */
export interface TokenBucketRateLimiterOptions {
  /** Bucket size - the most permits admissible at once (the maximum burst). */
  tokenLimit: number;
  /** Tokens restored each replenishment period. */
  tokensPerPeriod: number;
  /** Replenishment period in milliseconds (C#'s `ReplenishmentPeriod` `TimeSpan` -> ms `number`). */
  replenishmentPeriodMs: number;
  /** Queue depth for waiters. Only the no-queue (`0`) behaviour is ported; retained for shape parity. */
  queueLimit?: number;
  /** Whether tokens auto-replenish. Always effectively true here (replenishment is computed lazily from the clock). */
  autoReplenishment?: boolean;
}

/**
 * A token bucket: bursts up to `tokenLimit`, refilled by `tokensPerPeriod` every
 * `replenishmentPeriodMs`, one attempt costing its `permitCount` tokens, no queuing. Port of
 * `System.Threading.RateLimiting.TokenBucketRateLimiter`.
 *
 * As with the fixed-window limiter, .NET's timer-driven `AutoReplenishment` becomes lazy clock-driven
 * replenishment over an injectable `now`. A `permitCount` larger than `tokenLimit` can never be granted
 * and throws `RangeError` (the .NET `ArgumentOutOfRangeException` the middleware catches as a rejection)
 * - this is how a single over-sized payload is rejected under payload-size limiting.
 */
export class TokenBucketRateLimiter extends RateLimiter {
  private readonly tokenLimit: number;
  private readonly tokensPerPeriod: number;
  private readonly replenishmentPeriodMs: number;
  private tokens: number;
  private lastReplenish: number;

  constructor(
    options: TokenBucketRateLimiterOptions,
    private readonly now: () => number = () => Date.now(),
  ) {
    super();
    this.tokenLimit = options.tokenLimit;
    this.tokensPerPeriod = options.tokensPerPeriod;
    this.replenishmentPeriodMs = options.replenishmentPeriodMs;
    this.tokens = options.tokenLimit;
    this.lastReplenish = this.now();
  }

  attemptAcquire(permitCount = 1): RateLimitLease {
    assertPermitCount(permitCount, this.tokenLimit);
    if (permitCount === 0) {
      return acquiredZeroLease();
    }

    this.replenish();

    if (this.tokens >= permitCount) {
      this.tokens -= permitCount;
      return new RateLimitLease(true);
    }

    // Time until enough tokens will have accrued (best-effort - only surfaced in the error message).
    const deficit = permitCount - this.tokens;
    const periodsNeeded = Math.ceil(deficit / this.tokensPerPeriod);
    const retryAfterMs = Math.max(
      0,
      this.lastReplenish + periodsNeeded * this.replenishmentPeriodMs - this.now(),
    );
    return new RateLimitLease(false, new Map([[MetadataName.retryAfter.name, retryAfterMs]]));
  }

  private replenish(): void {
    const elapsed = this.now() - this.lastReplenish;
    if (elapsed < this.replenishmentPeriodMs) {
      return;
    }
    const periods = Math.floor(elapsed / this.replenishmentPeriodMs);
    this.tokens = Math.min(this.tokenLimit, this.tokens + periods * this.tokensPerPeriod);
    this.lastReplenish += periods * this.replenishmentPeriodMs;
  }
}

import { RateLimitLease } from './RateLimitLease';
import { acquiredZeroLease, assertPermitCount, RateLimiter } from './RateLimiter';

/** Options for {@link ConcurrencyLimiter}. Port of `ConcurrencyLimiterOptions` (the subset used). */
export interface ConcurrencyLimiterOptions {
  /** Maximum permits held concurrently. */
  permitLimit: number;
  /** Queue depth for waiters. Only the no-queue (`0`) behaviour is ported; retained for shape parity. */
  queueLimit?: number;
}

/**
 * Limits concurrent in-flight permits: each acquisition holds its `permitCount` until the lease is
 * disposed, at which point they are returned. Port of
 * `System.Threading.RateLimiting.ConcurrencyLimiter`.
 *
 * Unlike the window/bucket limiters this one carries no time component - it is the case that proves
 * {@link RateLimitingMiddleware} holds the lease across `next()` and disposes it afterwards, so
 * sequential messages each get the permit back.
 */
export class ConcurrencyLimiter extends RateLimiter {
  private readonly permitLimit: number;
  private available: number;

  constructor(options: ConcurrencyLimiterOptions) {
    super();
    this.permitLimit = options.permitLimit;
    this.available = options.permitLimit;
  }

  attemptAcquire(permitCount = 1): RateLimitLease {
    assertPermitCount(permitCount, this.permitLimit);
    if (permitCount === 0) {
      return acquiredZeroLease();
    }

    if (this.available >= permitCount) {
      this.available -= permitCount;
      return new RateLimitLease(true, undefined, () => {
        this.available += permitCount;
      });
    }

    return new RateLimitLease(false);
  }
}

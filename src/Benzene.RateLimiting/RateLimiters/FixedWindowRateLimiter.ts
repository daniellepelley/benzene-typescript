import { MetadataName, RateLimitLease } from './RateLimitLease';
import { acquiredZeroLease, assertPermitCount, RateLimiter } from './RateLimiter';

/** Options for {@link FixedWindowRateLimiter}. Port of `FixedWindowRateLimiterOptions` (the subset used). */
export interface FixedWindowRateLimiterOptions {
  /** Maximum permits admitted per window. */
  permitLimit: number;
  /** Window length in milliseconds (C#'s `Window` `TimeSpan` -> ms `number`). */
  windowMs: number;
  /** Queue depth for waiters. Only the no-queue (`0`) behaviour is ported; retained for shape parity. */
  queueLimit?: number;
  /** Whether the window auto-resets. Always effectively true here (reset is computed lazily from the clock). */
  autoReplenishment?: boolean;
}

/**
 * Admits at most `permitLimit` permits per fixed `windowMs`, no queuing - excess is rejected
 * immediately with a `retryAfter`. Port of `System.Threading.RateLimiting.FixedWindowRateLimiter`.
 *
 * .NET's timer-driven `AutoReplenishment` becomes lazy, clock-driven replenishment: each attempt first
 * rolls the window forward if the current one has elapsed (an injectable `now`, per the port's
 * TimeSpan -> ms + clock convention, keeps it deterministic in tests). Equivalent for the
 * attempt-only, no-queue path this package uses.
 */
export class FixedWindowRateLimiter extends RateLimiter {
  private readonly permitLimit: number;
  private readonly windowMs: number;
  private windowStart: number;
  private consumed = 0;

  constructor(
    options: FixedWindowRateLimiterOptions,
    private readonly now: () => number = () => Date.now(),
  ) {
    super();
    this.permitLimit = options.permitLimit;
    this.windowMs = options.windowMs;
    this.windowStart = this.now();
  }

  attemptAcquire(permitCount = 1): RateLimitLease {
    assertPermitCount(permitCount, this.permitLimit);
    if (permitCount === 0) {
      return acquiredZeroLease();
    }

    this.rollWindow();

    if (this.consumed + permitCount <= this.permitLimit) {
      this.consumed += permitCount;
      return new RateLimitLease(true);
    }

    const retryAfterMs = Math.max(0, this.windowStart + this.windowMs - this.now());
    return new RateLimitLease(false, new Map([[MetadataName.retryAfter.name, retryAfterMs]]));
  }

  private rollWindow(): void {
    if (this.now() - this.windowStart >= this.windowMs) {
      this.windowStart = this.now();
      this.consumed = 0;
    }
  }
}

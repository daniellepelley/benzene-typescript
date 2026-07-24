import { RateLimitLease } from './RateLimitLease';

/**
 * Abstract limiter over which {@link RateLimitingMiddleware} runs. Port of the
 * `System.Threading.RateLimiting.RateLimiter` subset used - just the synchronous, no-queue
 * `AttemptAcquire`.
 *
 * `attemptAcquire` throws {@link RangeError} (mirroring .NET's `ArgumentOutOfRangeException`) when
 * `permitCount` is negative or larger than the limiter could ever grant; the middleware catches that
 * and treats it as a rejection. `permitCount === 0` always succeeds with a no-op lease.
 */
export abstract class RateLimiter {
  abstract attemptAcquire(permitCount?: number): RateLimitLease;
}

/** A lease that acquired zero permits - always granted, disposal is a no-op. Shared helper for the limiters. */
export function acquiredZeroLease(): RateLimitLease {
  return new RateLimitLease(true);
}

/** Guards the shared `permitCount` preconditions; throws `RangeError` like .NET's `ArgumentOutOfRangeException`. */
export function assertPermitCount(permitCount: number, maximum: number): void {
  if (permitCount < 0) {
    throw new RangeError(`permitCount must not be negative (was ${permitCount})`);
  }
  if (permitCount > maximum) {
    throw new RangeError(`permitCount ${permitCount} exceeds the limiter maximum of ${maximum}`);
  }
}

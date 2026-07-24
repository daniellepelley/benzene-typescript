/** A between-attempts delay function. Port of C# `Func<TimeSpan, Task>` (TimeSpan -> milliseconds). */
export type SagaDelay = (milliseconds: number) => Promise<void>;

/**
 * An optional whole-saga retry policy: after a *clean* rollback (the system is back at its starting
 * state), re-run the entire saga up to {@link maxAttempts} times with exponential backoff. Retry is
 * deliberately limited to {@link SagaOutcome.RolledBack} - a succeeded saga needs no retry, and a
 * {@link SagaOutcome.PartiallyRolledBack} one may have left effects a retry would double-apply, so it is
 * surfaced for manual attention instead.
 * Port of Benzene.Saga.SagaRetryPolicy (`TimeSpan` -> millisecond `number`s).
 */
export class SagaRetryPolicy {
  /** The total number of attempts (1 = no retry). */
  readonly maxAttempts: number;

  /** The delay before the second attempt, in milliseconds. */
  readonly initialDelayMs: number;

  /** The multiplier applied to the delay after each attempt. */
  readonly backoffFactor: number;

  /** The delay function used between attempts. */
  readonly delay: SagaDelay;

  /**
   * @param maxAttempts The total number of attempts (1 = no retry). Must be at least 1.
   * @param initialDelayMs The delay before the second attempt, in milliseconds. Defaults to 0.
   * @param backoffFactor The multiplier applied to the delay after each attempt. Defaults to 2.
   * @param delay A delay function, overridable for tests. Defaults to a `setTimeout`-based delay.
   */
  constructor(
    maxAttempts = 3,
    initialDelayMs = 0,
    backoffFactor = 2,
    delay: SagaDelay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    if (maxAttempts < 1) {
      throw new Error('A saga must be attempted at least once.');
    }

    this.maxAttempts = maxAttempts;
    this.initialDelayMs = initialDelayMs;
    this.backoffFactor = backoffFactor;
    this.delay = delay;
  }
}

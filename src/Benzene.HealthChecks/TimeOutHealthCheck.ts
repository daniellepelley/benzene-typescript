/** Port of Benzene.HealthChecks.TimeOutHealthCheck. */
import { HealthCheckResult, IHealthCheck, IHealthCheckResult } from '@benzenejs/health-checks-core';

/**
 * Decorates an `IHealthCheck` with a timeout - 10 seconds by default, or the check's own
 * `IHealthCheck.timeout` override when it declares one: if the wrapped check has not completed within
 * that time, `executeAsync` returns a failed result (with an `Error`/`Timed Out` data entry) instead
 * of continuing to wait. Used internally by `HealthCheckProcessor` to wrap every check.
 *
 * This only stops *waiting* on the inner check - the inner promise is not cancelled and keeps running
 * to completion in the background even after a timeout is reported. C# uses `Task.WhenAny(delay, task)`;
 * the port uses `Promise.race` against a `setTimeout`-backed sentinel, clearing the timer once the
 * race settles (and `unref`-ing it so it never keeps a Node process alive).
 */
export class TimeOutHealthCheck implements IHealthCheck {
  /** The timeout applied when the constructor is not given one. */
  static readonly timeoutMs = 10000;

  private readonly timeoutMs: number;

  /**
   * @param inner The check to time out.
   * @param timeoutMs The timeout in milliseconds. Defaults to {@link TimeOutHealthCheck.timeoutMs}
   * (10s). `HealthCheckProcessor` passes each check's own `timeout` override here when set, matching
   * .NET's `TimeOutHealthCheck(inner, timeout)`.
   */
  constructor(
    private readonly inner: IHealthCheck,
    timeoutMs: number = TimeOutHealthCheck.timeoutMs,
  ) {
    this.timeoutMs = timeoutMs;
  }

  get type(): string {
    return this.inner.type;
  }

  async executeAsync(): Promise<IHealthCheckResult> {
    const task = this.inner.executeAsync();
    const timedOut = Symbol('timedOut');

    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<typeof timedOut>((resolve) => {
      timer = setTimeout(() => resolve(timedOut), this.timeoutMs);
      if (typeof (timer as { unref?: () => void }).unref === 'function') {
        (timer as { unref: () => void }).unref();
      }
    });

    try {
      const winner = await Promise.race([task, timeout]);
      if (winner !== timedOut) {
        return winner as IHealthCheckResult;
      }
      return HealthCheckResult.createInstance(false, this.inner.type, { Error: 'Timed Out' });
    } finally {
      clearTimeout(timer!);
    }
  }
}

/** Port of Benzene.HealthChecks.TimeOutHealthCheck. */
import { HealthCheckResult, IHealthCheck, IHealthCheckResult } from '@benzene/health-checks-core';

/**
 * Decorates an `IHealthCheck` with a fixed 10-second timeout: if the wrapped check has not completed
 * within that time, `executeAsync` returns a failed result (with an `Error`/`Timed Out` data entry)
 * instead of continuing to wait. The timeout is not currently configurable. Used internally by
 * `HealthCheckProcessor` to wrap every check.
 *
 * This only stops *waiting* on the inner check - the inner promise is not cancelled and keeps running
 * to completion in the background even after a timeout is reported. C# uses `Task.WhenAny(delay, task)`;
 * the port uses `Promise.race` against a `setTimeout`-backed sentinel, clearing the timer once the
 * race settles (and `unref`-ing it so it never keeps a Node process alive).
 */
export class TimeOutHealthCheck implements IHealthCheck {
  static readonly timeoutMs = 10000;

  constructor(private readonly inner: IHealthCheck) {}

  get type(): string {
    return this.inner.type;
  }

  async executeAsync(): Promise<IHealthCheckResult> {
    const task = this.inner.executeAsync();
    const timedOut = Symbol('timedOut');

    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<typeof timedOut>((resolve) => {
      timer = setTimeout(() => resolve(timedOut), TimeOutHealthCheck.timeoutMs);
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

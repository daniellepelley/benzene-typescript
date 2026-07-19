/** Port of Benzene.HealthChecks.ExceptionHandlingHealthCheck. */
import { HealthCheckResult, IHealthCheck, IHealthCheckResult } from '@benzene/health-checks-core';

/**
 * Decorates an `IHealthCheck` so that an error thrown out of `executeAsync` is caught and turned into
 * a failed `IHealthCheckResult` (with the error's class name in its `data`) instead of propagating
 * and aborting the whole health check run. Used internally by `HealthCheckProcessor` to wrap every
 * check.
 */
export class ExceptionHandlingHealthCheck implements IHealthCheck {
  constructor(private readonly inner: IHealthCheck) {}

  get type(): string {
    return this.inner.type;
  }

  /**
   * Runs the wrapped check. If it throws, returns a failed result containing the error's class name
   * instead of letting it propagate. Deliberately reports the class name, not the message - error
   * messages can carry sensitive details, and this result can flow out to whatever calls the health
   * check topic with no built-in authorization. (C# `ex.GetType().Name` -> the error's constructor
   * name.)
   */
  async executeAsync(): Promise<IHealthCheckResult> {
    try {
      return await this.inner.executeAsync();
    } catch (ex) {
      return HealthCheckResult.createInstance(false, this.inner.type, {
        Exception: errorName(ex),
      });
    }
  }
}

function errorName(ex: unknown): string {
  if (ex instanceof Error) {
    return ex.constructor.name;
  }
  return typeof ex;
}

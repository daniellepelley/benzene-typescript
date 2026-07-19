/** Port of Benzene.HealthChecks.FailedHealthCheck. */
import { HealthCheckResult, IHealthCheck, IHealthCheckResult } from '@benzene/health-checks-core';

/**
 * A placeholder `IHealthCheck` that always reports a failed result carrying the class name of a
 * pre-existing error. Used by `buildHealthCheck` to represent a health check that could not even be
 * constructed.
 */
export class FailedHealthCheck implements IHealthCheck {
  constructor(private readonly error: unknown) {}

  get type(): string {
    return 'Failed';
  }

  /**
   * Always returns a failed result whose `data` contains the wrapped error's class name (not its
   * message - see `ExceptionHandlingHealthCheck` for why) under the `Exception` key.
   */
  executeAsync(): Promise<IHealthCheckResult> {
    const name = this.error instanceof Error ? this.error.constructor.name : typeof this.error;
    return Promise.resolve(
      HealthCheckResult.createInstance(false, this.type, { Exception: name }),
    );
  }
}

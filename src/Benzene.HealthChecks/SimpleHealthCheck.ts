/** Port of Benzene.HealthChecks.SimpleHealthCheck. */
import { HealthCheckResult, IHealthCheck, IHealthCheckResult } from '@benzene/health-checks-core';

/**
 * A trivial `IHealthCheck` that always reports success with no diagnostic data. Useful as a smoke
 * test that the health check pipeline itself is wired up and reachable, or as a placeholder while
 * building out real checks.
 */
export class SimpleHealthCheck implements IHealthCheck {
  get type(): string {
    return 'Simple';
  }

  executeAsync(): Promise<IHealthCheckResult> {
    return Promise.resolve(HealthCheckResult.createInstance(true, this.type));
  }
}

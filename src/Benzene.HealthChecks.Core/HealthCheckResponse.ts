/** Port of Benzene.HealthChecks.Core.HealthCheckResponse. */
import { HealthCheckResult } from './HealthCheckResult';
import { IHealthCheckResponse } from './IHealthCheckResponse';

/** Default `IHealthCheckResponse` implementation, closing the generic over `HealthCheckResult`. */
export class HealthCheckResponse implements IHealthCheckResponse<HealthCheckResult> {
  readonly isHealthy: boolean;
  readonly healthChecks: Record<string, HealthCheckResult>;

  constructor(isHealthy: boolean, healthChecks: Record<string, HealthCheckResult>) {
    this.healthChecks = healthChecks;
    this.isHealthy = isHealthy;
  }
}

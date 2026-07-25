/**
 * The service's health document - the same `{ isHealthy, healthChecks }` shape a .NET Benzene service's
 * `/benzene/health` endpoint serves, so the mesh reads it identically across languages. A real service would
 * run its registered health checks here; the example reports a single healthy self-check.
 */
import { HealthCheckResponse, HealthCheckResult } from '@benzene/health-checks-core';

/** Builds the health document JSON. */
export function buildHealth(): string {
  const response = new HealthCheckResponse(true, {
    self: HealthCheckResult.createInstance(true, 'Self'),
  });
  return JSON.stringify(response, null, 2);
}

/** Port of Benzene.HealthChecks.IHealthCheckFinder. */
import { ServiceToken, serviceToken } from '@benzenejs/abstractions';
import { IDependencyHealthCheck, IHealthCheck } from '@benzenejs/health-checks-core';

/** Discovers the set of `IHealthCheck`s that have been registered with the dependency container. */
export interface IHealthCheckFinder {
  /**
   * Returns the checks registered as plain `IHealthCheck` (process-local self-checks and any the
   * developer registered directly). Does **not** include the dependency-category checks — this is the
   * probe-safe set.
   */
  findHealthChecks(): IHealthCheck[];

  /**
   * Returns the dependency-category checks (`IDependencyHealthCheck` — auto-wired external dependency
   * checks), de-duplicated by `dedupKey` so two registrations of the same dependency collapse to one.
   * Harvested by the general `benzene:healthcheck` probe only, never by liveness/readiness/contracts.
   */
  findDependencyHealthChecks(): IDependencyHealthCheck[];
}

export const IHealthCheckFinder: ServiceToken<IHealthCheckFinder> =
  serviceToken<IHealthCheckFinder>('IHealthCheckFinder');

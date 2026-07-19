/** Port of Benzene.HealthChecks.IHealthCheckFinder. */
import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { IHealthCheck } from '@benzene/health-checks-core';

/** Discovers the set of `IHealthCheck`s that have been registered with the dependency container. */
export interface IHealthCheckFinder {
  /** Returns every registered health check, in no particular guaranteed order. */
  findHealthChecks(): IHealthCheck[];
}

export const IHealthCheckFinder: ServiceToken<IHealthCheckFinder> =
  serviceToken<IHealthCheckFinder>('IHealthCheckFinder');

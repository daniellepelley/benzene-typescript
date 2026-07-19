/** Port of Benzene.HealthChecks.Core.IHealthCheck. */
import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { IHealthCheckResult } from './IHealthCheckResult';

/**
 * A single health check: verifies one dependency or condition (e.g. database connectivity, a
 * downstream HTTP service) and reports the outcome. Implementations are typically registered via
 * `IHealthCheckBuilder` and run together by the health-check aggregator, which collects them from
 * the container via `resolver.getServices(IHealthCheck)`.
 */
export interface IHealthCheck {
  /** A short identifier for this check, used as its key in the aggregated response (e.g. "Database", "HttpPing"). */
  readonly type: string;

  /**
   * Runs the check and returns its outcome. Should not throw for expected failure conditions (e.g.
   * connection refused) - report them via a failed `IHealthCheckResult` instead.
   */
  executeAsync(): Promise<IHealthCheckResult>;
}

/**
 * Container token for `IHealthCheck`. C# resolves the set of checks by the `IHealthCheck` type
 * (`IEnumerable<IHealthCheck>`); TypeScript erases types, so the interface declares a merged
 * `ServiceToken` and the finder resolves them via `resolver.getServices(IHealthCheck)`.
 */
export const IHealthCheck: ServiceToken<IHealthCheck> = serviceToken<IHealthCheck>('IHealthCheck');

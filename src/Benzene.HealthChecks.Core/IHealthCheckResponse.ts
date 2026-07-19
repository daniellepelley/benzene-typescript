/** Port of Benzene.HealthChecks.Core.IHealthCheckResponse. */
import { IHealthCheckResult } from './IHealthCheckResult';

/**
 * The aggregated outcome of running every registered `IHealthCheck`.
 * @typeParam THealthCheckResult The concrete result type each individual check reported.
 */
export interface IHealthCheckResponse<THealthCheckResult extends IHealthCheckResult> {
  /**
   * `true` unless at least one check reported `HealthCheckStatus.failed` - a `warning` result does
   * not flip this to false (see `HealthCheckProcessor.performHealthChecksAsync` for the exact rule).
   */
  readonly isHealthy: boolean;

  /** Every check's result, keyed by its `IHealthCheck.type`. C# `IDictionary<string, T>` -> `Record<string, T>`. */
  readonly healthChecks: Record<string, THealthCheckResult>;
}

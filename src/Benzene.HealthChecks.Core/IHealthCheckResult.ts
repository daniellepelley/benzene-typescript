/** Port of Benzene.HealthChecks.Core.IHealthCheckResult. */
import { HealthCheckDependency } from './HealthCheckDependency';

/** The outcome of running one `IHealthCheck`. */
export interface IHealthCheckResult {
  /** One of `HealthCheckStatus.ok`, `HealthCheckStatus.warning`, or `HealthCheckStatus.failed`. */
  readonly status: string;

  /** The identifier of the check that produced this result (matches `IHealthCheck.type`). */
  readonly type: string;

  /**
   * Arbitrary diagnostic details specific to the check (e.g. the URL pinged, the exception name).
   * C# `IDictionary<string, object>` -> `Record<string, unknown>`.
   */
  readonly data: Record<string, unknown>;

  /**
   * The external dependencies this check verifies. In C# this is a default interface member
   * defaulting to an empty array; TypeScript interfaces cannot carry a default, so it is a required
   * property here and the concrete `HealthCheckResult` supplies the empty-array default in its stead.
   */
  readonly dependencies: HealthCheckDependency[];
}

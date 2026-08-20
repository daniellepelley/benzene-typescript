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

  /**
   * How long the check took to run, in milliseconds, filled in by the aggregating processor (an
   * individual check need not set it). In C# this is a default interface member (`TimeSpan Duration =>
   * Zero`); as with `dependencies`, TypeScript interfaces cannot carry a default, so it is a required
   * property here and the concrete `HealthCheckResult` supplies the `0` default in its stead.
   */
  readonly duration: number;

  /**
   * Whether a `HealthCheckStatus.failed` result represents a **persistent**, deterministic fault
   * (e.g. an authorization/permission denial or bad credentials) rather than a transient blip. A
   * persistent failure is **not** softened by the non-critical downgrade: it won't self-heal, so it
   * surfaces as unhealthy on the deep `benzene:healthcheck` layer even for an auto-wired dependency-category
   * check. C# default interface member; required here (the concrete `HealthCheckResult` supplies the
   * `false` default). Only meaningful on a `failed` result.
   */
  readonly isPersistent: boolean;
}

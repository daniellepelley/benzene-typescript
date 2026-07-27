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

  // The members below are C# default interface members. TypeScript interfaces can't carry a default
  // implementation, so they are OPTIONAL here and every consumer reads them through a `?? default`
  // (see `HealthCheckProcessor`, `DependencyHealthCheck`). This preserves the .NET semantics — an
  // implementer may omit them and get the documented default — while a check can still describe its
  // own routing/criticality/cost rather than have those decided processor-wide.

  /**
   * Open-string labels for routing/filtering a check. Defaults to none. Probe separation
   * (liveness/readiness) is done by dedicated topic + the dependency registration category, not by a
   * tag — tags are for finer filtering on top of that.
   */
  readonly tags?: string[];

  /**
   * Whether a failure of this check should **not** make the whole probe unhealthy. Defaults to
   * `false` — a check is critical unless it opts out, so a `HealthCheckStatus.failed` flips the
   * aggregated response to unhealthy. Set to `true` to have a failure downgraded to
   * `HealthCheckStatus.warning` during aggregation, so a non-critical dependency being down degrades
   * but does not take the instance out of service.
   *
   * The polarity is deliberate (`isNonCritical`, not `isCritical`): the default/unknown value must
   * fail **safe** (critical). An unset/`undefined` value therefore reads as critical.
   */
  readonly isNonCritical?: boolean;

  /**
   * A per-check cache lifetime hint (milliseconds) for a caching processor, overriding its
   * processor-wide TTL. Defaults to `undefined` (use the processor's TTL). Reserved for a future
   * per-check caching layer.
   */
  readonly ttl?: number;

  /**
   * A per-check timeout (milliseconds), overriding the processor-wide timeout. Defaults to
   * `undefined` (use the processor's timeout). Lets a known-slow check have a longer budget, or a
   * must-be-fast one a shorter budget, without widening the timeout for every check.
   */
  readonly timeout?: number;
}

/**
 * Container token for `IHealthCheck`. C# resolves the set of checks by the `IHealthCheck` type
 * (`IEnumerable<IHealthCheck>`); TypeScript erases types, so the interface declares a merged
 * `ServiceToken` and the finder resolves them via `resolver.getServices(IHealthCheck)`.
 */
export const IHealthCheck: ServiceToken<IHealthCheck> = serviceToken<IHealthCheck>('IHealthCheck');

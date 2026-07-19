/** Port of Benzene.HealthChecks.Core.HealthCheckStatus. */

/**
 * The status strings an `IHealthCheckResult` reports.
 *
 * C# `public static class` of `const string`s becomes a frozen object. The member names are
 * camelCased per the porting convention (`Ok` -> `ok`, ...) but the underlying string VALUES are
 * kept exactly ("ok"/"warning"/"failed") - they are the wire values, not the identifiers.
 */
export const HealthCheckStatus = {
  /** The check passed. */
  ok: 'ok',

  /** The check found a degraded but non-fatal condition - does not flip an aggregated response's `isHealthy` to false. */
  warning: 'warning',

  /** The check failed - flips an aggregated response's `isHealthy` to false. */
  failed: 'failed',
} as const;

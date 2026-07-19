/** Port of Benzene.HealthChecks.HealthCheckProcessor. */
import { IBenzeneResult } from '@benzene/abstractions';
import {
  HealthCheckResponse,
  HealthCheckResult,
  HealthCheckStatus,
  IHealthCheck,
} from '@benzene/health-checks-core';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import { ExceptionHandlingHealthCheck } from './ExceptionHandlingHealthCheck';
import { HealthCheckNamer } from './HealthCheckNamer';
import { TimeOutHealthCheck } from './TimeOutHealthCheck';

/**
 * Runs a set of health checks and aggregates their outcomes into a single result.
 * C# `static class` -> a plain object with the static method as a property, so call sites read
 * `HealthCheckProcessor.performHealthChecksAsync(...)` exactly as in .NET.
 */
export const HealthCheckProcessor = {
  /**
   * Runs every check concurrently and aggregates the results. Each check is wrapped, before running,
   * in a `TimeOutHealthCheck` (failed with an `Error`/`Timed Out` entry if it doesn't complete in
   * time) around an `ExceptionHandlingHealthCheck` (an error thrown by the check becomes a failed
   * result rather than propagating) - implementations of `IHealthCheck` need not implement their own
   * timeout or exception handling. The aggregate's `isHealthy` is `true` unless at least one check
   * reports `HealthCheckStatus.failed`; a `warning` does not flip it to false. Each check's key in
   * the resulting `healthChecks` record is assigned via `HealthCheckNamer` to stay unique even when
   * multiple checks share the same (or an empty) `type`.
   *
   * Returns an `IBenzeneResult` whose payload is a `HealthCheckResponse`, with status `Ok` (HTTP 200)
   * when healthy or `ServiceUnavailable` (HTTP 503, but explicitly successful so the body still
   * renders the report) when not - making it usable by any consumer that inspects only the HTTP
   * status code, such as a Kubernetes probe or a load-balancer target-health check.
   *
   * @param _topic The topic the checks were run for. Currently unused by this method itself, but
   * accepted for callers that need to correlate the run with a topic (matches the C# signature).
   */
  async performHealthChecksAsync(_topic: string, healthChecks: IHealthCheck[]): Promise<IBenzeneResult> {
    const running = healthChecks.map((x) => ({
      type: x.type,
      resultPromise: new TimeOutHealthCheck(new ExceptionHandlingHealthCheck(x)).executeAsync(),
    }));

    const results = await Promise.all(running.map((x) => x.resultPromise));
    const isHealthy = results.every((x) => x.status !== HealthCheckStatus.failed);

    const namer = new HealthCheckNamer();
    const healthChecksRecord: Record<string, HealthCheckResult> = {};
    for (const result of results) {
      healthChecksRecord[namer.getName(result.type)] = new HealthCheckResult(
        result.status,
        result.type,
        result.data,
        result.dependencies,
      );
    }

    const message = new HealthCheckResponse(isHealthy, healthChecksRecord);

    // Unhealthy: ServiceUnavailable so HTTP probes see a 503, but explicitly successful so the
    // response body renders the health report payload rather than an error payload.
    return isHealthy
      ? BenzeneResult.ok(message)
      : BenzeneResult.set(BenzeneResultStatus.serviceUnavailable, message, true);
  },
} as const;

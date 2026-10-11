/** Port of Benzene.HealthChecks.HealthCheckProcessor. */
import { IBenzeneResult } from '@benzenejs/abstractions';
import {
  HealthCheckResponse,
  HealthCheckResult,
  HealthCheckStatus,
  IHealthCheck,
} from '@benzenejs/health-checks-core';
import { BenzeneResult } from '@benzenejs/results';
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
   * Returns an `IBenzeneResult` with status `ok` whenever the checks ran, whose payload is a
   * `HealthCheckResponse`: `isHealthy` carries the verdict (wire-contracts §5). An unhealthy service is
   * still a successful health query. A transport with a status of its own maps the verdict onto it — the
   * HTTP binding answers a health route with 503 when `isHealthy` is false (`HttpStatusCodeResponseHandler`),
   * so a Kubernetes probe or a load-balancer target-health check that reads only the status line still
   * sees it.
   *
   * @param _topic The topic the checks were run for. Currently unused by this method itself, but
   * accepted for callers that need to correlate the run with a topic (matches the C# signature).
   */
  async performHealthChecksAsync(_topic: string, healthChecks: IHealthCheck[]): Promise<IBenzeneResult> {
    const results = await Promise.all(healthChecks.map((x) => runTimedAsync(x)));
    const isHealthy = results.every((x) => x.status !== HealthCheckStatus.failed);

    const namer = new HealthCheckNamer();
    const healthChecksRecord: Record<string, HealthCheckResult> = {};
    for (const result of results) {
      healthChecksRecord[namer.getName(result.type)] = result;
    }

    const message = new HealthCheckResponse(isHealthy, healthChecksRecord);

    // `ok` whenever the checks ran; the verdict is the payload's `isHealthy` (wire-contracts §5, D2).
    return BenzeneResult.ok(message);
  },
} as const;

/**
 * Times a single check and rebuilds its result with the measured duration. Honours the check's own
 * `timeout` override (passed to `TimeOutHealthCheck`) and applies the non-critical downgrade: a
 * `failed` result of a non-critical check (`IHealthCheck.isNonCritical`) is softened to `warning` so a
 * non-critical dependency being down degrades rather than takes the instance out of service — **unless**
 * the failure is persistent (`IHealthCheckResult.isPersistent`, e.g. an authorization denial), which
 * escapes the downgrade and stays `failed`. Mirrors .NET's `HealthCheckProcessor.RunTimedAsync`.
 */
async function runTimedAsync(healthCheck: IHealthCheck): Promise<HealthCheckResult> {
  const check = new TimeOutHealthCheck(new ExceptionHandlingHealthCheck(healthCheck), healthCheck.timeout);

  const start = Date.now();
  const result = await check.executeAsync();
  const duration = Date.now() - start;

  const status =
    result.status === HealthCheckStatus.failed && (healthCheck.isNonCritical ?? false) && !result.isPersistent
      ? HealthCheckStatus.warning
      : result.status;

  return new HealthCheckResult(status, result.type, result.data, result.dependencies, duration, result.isPersistent);
}

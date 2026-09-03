/** Port of Benzene.Clients.HealthChecks.ClientHealthCheck. */
import { IBenzeneResultOf, VoidResult } from '@benzenejs/abstractions';
import {
  HealthCheckDependency,
  HealthCheckResponse,
  HealthCheckResult,
  HealthCheckStatus,
  IHealthCheck,
  IHealthCheckResult,
  SchemaHealthCheckConstants,
} from '@benzenejs/health-checks-core';
import { ClientHashMatch } from './ClientHashMatch';
import { IHasHealthCheck } from './IHasHealthCheck';

/**
 * A consumer-side `IHealthCheck` that probes a single downstream provider via its generated client
 * ({@link IHasHealthCheck}) and reports both whether it is reachable and whether its message contract
 * has drifted from the one this client was generated against. The provider's response is already
 * drift-annotated by the generated client's `healthCheckAsync` (which runs
 * {@link ClientHealthCheckProcessor}); this adapter folds that aggregated response down into one result.
 * Port of Benzene.Clients.HealthChecks.ClientHealthCheck.
 *
 * Register this on the CONTRACTS diagnostic topic (`useContractsCheck` + `addContractCheck`), NOT a
 * liveness/readiness probe: it calls a downstream service, so a probe including it would let one
 * struggling dependency restart or de-route otherwise-healthy pods. Its outcomes track the CONTRACT
 * relationship, not the provider's transient internal health: reachable+matching is `ok`,
 * reachable+drifted is `warning` (degraded-but-not-fatal, does not flip `isHealthy`), and only an
 * unreachable provider is `failed`.
 */
export class ClientHealthCheck implements IHealthCheck {
  /**
   * @param onError Optional server-side hook receiving the RAW error when the probe throws — the place
   * to log the full message/stack. The health payload itself only ever carries the error's
   * type/category (see {@link executeAsync}), never the message.
   */
  constructor(
    private readonly serviceName: string,
    private readonly client: IHasHealthCheck,
    private readonly onError?: (error: unknown) => void,
  ) {}

  get type(): string {
    return this.serviceName;
  }

  async executeAsync(): Promise<IHealthCheckResult> {
    const dependencies = [new HealthCheckDependency('Service', this.serviceName)];

    let result: IBenzeneResultOf<HealthCheckResponse> | undefined;
    try {
      result = await this.client.healthCheckAsync();
    } catch (ex) {
      // IHealthCheck contract: report expected failures (e.g. connection refused) as a failed result
      // rather than throwing. The processor's outer wrappers remain the backstop.
      //
      // R18 #298's info-leak rule (the Go port's long-documented stance, settled cross-port): the
      // health payload carries only the error's TYPE/category — an exception message can embed infra
      // detail (hostnames, connection strings, file paths) that a health caller must never see. The
      // raw error goes only to the server-side `onError` log hook.
      this.onError?.(ex);
      return new HealthCheckResult(
        HealthCheckStatus.failed,
        this.serviceName,
        { reachable: false, error: errorCategory(ex) },
        dependencies,
      );
    }

    // No health response at all -> provider unreachable. This only ever colours the contracts
    // diagnostic topic; it is never wired into a probe, so it cannot restart or de-route a pod.
    // DIVERGENCE: C# checks `Payload == null`, but the port's `BenzeneResult` never yields a null
    // payload - a failure result carries the `VoidResult` sentinel (see `BenzeneResult.setErrors`), so
    // "no payload" here means null/undefined OR that sentinel.
    const payload = result?.payload;
    if (payload == null || payload instanceof VoidResult) {
      const data: Record<string, unknown> = { reachable: false };
      if (result !== undefined && result !== null) {
        data.status = result.status;
        if (result.errors !== undefined && result.errors.length > 0) {
          // The messages, not the structured errors: this is a health-check data bag read by
          // dashboards and probes, and a flat string list is what they already understand. The
          // field/code detail belongs on the wire's problem document, not here.
          data.errors = result.errors.map((error) => error.message);
        }
      }

      return new HealthCheckResult(HealthCheckStatus.failed, this.serviceName, data, dependencies);
    }

    // Reachable: surface the contract-drift verdict already annotated onto the provider's response.
    const match = findMatch(payload);
    const data: Record<string, unknown> = { reachable: true };
    if (match !== undefined) {
      data[SchemaHealthCheckConstants.matchKey] = match;
    }

    // Genuine drift (both hashes present and differing) is degraded-but-not-fatal -> warning, which
    // does not flip the aggregate isHealthy. A matching contract, or no schema check to compare against
    // (can't determine drift), stays ok - no false warning.
    const drifted = match !== undefined && !match.isMatch && match.serviceHashCode !== undefined;
    return drifted
      ? new HealthCheckResult(HealthCheckStatus.warning, this.serviceName, data, dependencies)
      : new HealthCheckResult(HealthCheckStatus.ok, this.serviceName, data, dependencies);
  }
}

function findMatch(response: HealthCheckResponse): ClientHashMatch | undefined {
  const schemaCheck = Object.values(response.healthChecks).find(
    (x) => x.type === SchemaHealthCheckConstants.type,
  );

  const raw = schemaCheck?.data[SchemaHealthCheckConstants.matchKey];
  return raw instanceof ClientHashMatch ? raw : undefined;
}

/**
 * The error's coarse type/category — its constructor name (falling back to `Error.name`), or, for a
 * non-`Error` throw, its `typeof` (never `String(ex)`, which would leak a thrown string's content).
 * Deliberately NOT `ex.message` — see the catch in {@link ClientHealthCheck.executeAsync}.
 */
function errorCategory(ex: unknown): string {
  if (ex instanceof Error) {
    return ex.constructor.name !== '' ? ex.constructor.name : ex.name;
  }
  return typeof ex;
}

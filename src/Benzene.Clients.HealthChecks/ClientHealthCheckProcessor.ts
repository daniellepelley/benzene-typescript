/** Port of Benzene.Clients.HealthChecks.ClientHealthCheckProcessor. */
import {
  HealthCheckResponse,
  HealthCheckResult,
  HealthCheckStatus,
  IHealthCheckResponse,
  SchemaHealthCheckConstants,
} from '@benzene/health-checks-core';
import { ClientHashMatch } from './ClientHashMatch';

/**
 * The consumer side of the contract-drift check: compares the contract hash a client was generated
 * against with the provider's live contract hash, published by the provider's `SchemaHealthCheck` in
 * its `schema` health check.
 *
 * C# static class of one static method -> a const object of one function.
 */
export const ClientHealthCheckProcessor = {
  /**
   * Reads the provider's schema hash out of `healthCheckResponse`, compares it with `hashCode` (the
   * hash the client was generated against), and writes the verdict as a {@link ClientHashMatch} into
   * the schema health check's data. Returns the response with that check annotated.
   */
  process(
    healthCheckResponse: IHealthCheckResponse<HealthCheckResult>,
    hashCode: string,
  ): IHealthCheckResponse<HealthCheckResult> {
    const entry = Object.entries(healthCheckResponse.healthChecks).find(
      ([, value]) => value.type === SchemaHealthCheckConstants.type,
    );

    // No schema health check to compare against - nothing to annotate, pass the response through.
    if (entry === undefined) {
      return new HealthCheckResponse(healthCheckResponse.isHealthy, healthCheckResponse.healthChecks);
    }

    const [entryKey, schemaHealthCheck] = entry;

    // The hash is published as a plain string, but after a serialize/deserialize round-trip it may
    // arrive as some other JSON scalar rather than a string; `String(...)` normalizes it (C# used
    // `raw?.ToString()` to cover JsonElement/JToken without a hard dependency on either JSON library).
    const rawHash = schemaHealthCheck.data[SchemaHealthCheckConstants.hashCodeKey];
    const serviceHashCode = rawHash === undefined || rawHash === null ? undefined : String(rawHash);

    const isMatch = serviceHashCode !== undefined && hashCode === serviceHashCode;

    // Copy the data (don't mutate the caller's result) and record the verdict.
    const match = new ClientHashMatch();
    match.serviceHashCode = serviceHashCode;
    match.clientHashCode = hashCode;
    match.isMatch = isMatch;
    const data = { ...schemaHealthCheck.data, [SchemaHealthCheckConstants.matchKey]: match };

    // Genuine drift (both hashes present and differing) degrades the schema check to Warning so a
    // health consumer sees drift as a first-class status, not only buried in data. Warning does not
    // flip the aggregate isHealthy (drift is degraded-but-not-fatal), and a check that already reports
    // Warning/Failed - or that has no hash to compare against - keeps its own status.
    const status =
      serviceHashCode !== undefined && !isMatch && schemaHealthCheck.status === HealthCheckStatus.ok
        ? HealthCheckStatus.warning
        : schemaHealthCheck.status;

    const annotated = new HealthCheckResult(
      status,
      schemaHealthCheck.type,
      data,
      schemaHealthCheck.dependencies,
    );

    const healthChecks = { ...healthCheckResponse.healthChecks, [entryKey]: annotated };

    return new HealthCheckResponse(healthCheckResponse.isHealthy, healthChecks);
  },
};

/**
 * Port of Benzene.HealthChecks.Schema — the provider-side contract (schema) health check.
 *
 * `addSchemaHealthCheck(builder)` registers a check that hashes the service's current message contract
 * (every registered handler's topic + request/response schema) and publishes the hash under the
 * `schema` health check, so a consumer's `@benzenejs/clients-health-checks` drift check can compare it
 * against the hash its client was built against.
 */
export * from './SchemaHealthCheck';
export * from './SchemaHealthCheckExtensions';

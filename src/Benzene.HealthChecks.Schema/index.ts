/**
 * Port of Benzene.HealthChecks.Schema — the provider-side contract (schema) health check.
 *
 * `addSchemaHealthCheck(builder)` registers a check that publishes the `contractHash` of the Contract
 * Document the service serves (contract-document.md §6) under the `schema` health check, so a consumer's
 * `@benzenejs/clients-health-checks` drift check can compare it with the hash its client was built against.
 */
export * from './SchemaHealthCheck';
export * from './SchemaHealthCheckExtensions';

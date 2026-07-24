/** Port of Benzene.HealthChecks.Core.SchemaHealthCheckConstants. */

/**
 * The shared keys/type the schema (contract) health check publishes under, so a provider's
 * `SchemaHealthCheck` and a consumer's contract-drift check agree on where the hash and verdict live.
 *
 * C# `public static class` of `const string`s -> a frozen object. Member names are camelCased per the
 * porting convention, but the string VALUES are kept exactly ("schema"/"hashCode"/"match") - they are
 * the wire keys, not identifiers.
 */
export const SchemaHealthCheckConstants = {
  /** The `IHealthCheckResult.type` a schema/contract health check reports under. */
  type: 'schema',

  /** The `data` key the contract hash is published under (a plain string, so it survives any JSON round-trip). */
  hashCodeKey: 'hashCode',

  /** The `data` key the consumer writes its hash-match verdict under after comparing. */
  matchKey: 'match',
} as const;

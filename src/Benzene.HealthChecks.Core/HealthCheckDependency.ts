/** Port of Benzene.HealthChecks.Core.HealthCheckDependency. */

/** Describes one external dependency an `IHealthCheck` verifies connectivity to. */
export class HealthCheckDependency {
  /**
   * @param kind The category of dependency, e.g. "Queue"/"Database"/"Http"/"Lambda"/"StateMachine"/
   * "Cache". An open string rather than an enum, so new dependency kinds don't require a shared type.
   * @param name The specific resource identifier, e.g. a queue URL, a DbContext type name, an
   * endpoint URL, or a function name. Never a connection string or other secret.
   */
  constructor(
    public readonly kind: string,
    public readonly name: string,
  ) {}
}

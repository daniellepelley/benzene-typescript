/** Port of Benzene.HealthChecks.HealthCheckFinder. */
import { IDependencyHealthCheck, IHealthCheck } from '@benzenejs/health-checks-core';
import { IHealthCheckFinder } from './IHealthCheckFinder';

/**
 * Default `IHealthCheckFinder` implementation. Relies on the dependency injection container to supply
 * every `IHealthCheck` registered against that token, and every `IDependencyHealthCheck` registered
 * against the dependency-category token — the two sets stay disjoint (a plain check is not resolved as
 * a dependency check and vice versa), so liveness/readiness (which resolve only `IHealthCheck`) never
 * harvest a dependency check.
 *
 * Reflection -> DI substitution: the .NET stack injects `IEnumerable<IHealthCheck>` /
 * `IEnumerable<IDependencyHealthCheck>`; the port takes the two iterables resolved via
 * `resolver.getServices(...)` at registration time (see `HealthCheckBuilder`).
 */
export class HealthCheckFinder implements IHealthCheckFinder {
  private readonly healthChecks: IHealthCheck[];
  private readonly dependencyHealthChecks: IDependencyHealthCheck[];

  constructor(healthChecks: Iterable<IHealthCheck>, dependencyHealthChecks: Iterable<IDependencyHealthCheck> = []) {
    this.healthChecks = [...healthChecks];
    // De-dup by key so two registrations of the same dependency collapse to one check. `dedupKey`
    // falls back to `type` (matching the C# default interface member) when a check doesn't set one.
    const seen = new Map<string, IDependencyHealthCheck>();
    for (const check of dependencyHealthChecks) {
      const key = check.dedupKey ?? check.type;
      if (!seen.has(key)) {
        seen.set(key, check);
      }
    }
    this.dependencyHealthChecks = [...seen.values()];
  }

  findHealthChecks(): IHealthCheck[] {
    return this.healthChecks;
  }

  findDependencyHealthChecks(): IDependencyHealthCheck[] {
    return this.dependencyHealthChecks;
  }
}

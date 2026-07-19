/** Port of Benzene.HealthChecks.HealthCheckFinder. */
import { IHealthCheck } from '@benzene/health-checks-core';
import { IHealthCheckFinder } from './IHealthCheckFinder';

/**
 * Default `IHealthCheckFinder` implementation. Relies on the dependency injection container to supply
 * every `IHealthCheck` registered against that token.
 *
 * Reflection -> DI substitution: the .NET stack discovers checks by injecting
 * `IEnumerable<IHealthCheck>` (populated from container registrations); the port takes an
 * `Iterable<IHealthCheck>` resolved via `resolver.getServices(IHealthCheck)` at registration time
 * (see `HealthCheckBuilder`), the same discovery approach used for message-handler finders.
 */
export class HealthCheckFinder implements IHealthCheckFinder {
  private readonly healthChecks: IHealthCheck[];

  constructor(healthChecks: Iterable<IHealthCheck>) {
    this.healthChecks = [...healthChecks];
  }

  findHealthChecks(): IHealthCheck[] {
    return this.healthChecks;
  }
}

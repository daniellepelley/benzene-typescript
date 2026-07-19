/** Port of Benzene.HealthChecks.HealthCheckBuilder. */
import { InjectableConstructor, IRegisterDependency, IServiceResolver } from '@benzene/abstractions';
import { IHealthCheck, IHealthCheckBuilder } from '@benzene/health-checks-core';
import { HealthCheckFinder } from './HealthCheckFinder';
import { IHealthCheckFinder } from './IHealthCheckFinder';
import { InlineHealthCheck } from './InlineHealthCheck';

/**
 * Default `IHealthCheckBuilder` implementation. Health checks registered via `addHealthCheck` (the
 * DI-resolved type overload) are registered as scoped services against the `IHealthCheck` token, and
 * discovered through `IHealthCheckFinder`; health checks registered via `addHealthCheckFn` are held
 * in-memory and wrapped as `InlineHealthCheck`s at resolution time.
 *
 * Reflection -> DI substitution: the constructor registers the `IHealthCheckFinder` singleton whose
 * factory resolves the set of container-registered checks via `resolver.getServices(IHealthCheck)`,
 * the same discovery approach used for message-handler finders (in place of .NET assembly/DI scan).
 */
export class HealthCheckBuilder implements IHealthCheckBuilder {
  private readonly healthCheckBuilders: Array<(resolver: IServiceResolver) => IHealthCheck> = [];

  constructor(private readonly register: IRegisterDependency) {
    this.register.register((container) =>
      container.addSingletonFactory(
        IHealthCheckFinder,
        (resolver) => new HealthCheckFinder(resolver.getServices(IHealthCheck)),
      ),
    );
  }

  addHealthCheck(healthCheck: InjectableConstructor<IHealthCheck>): IHealthCheckBuilder {
    this.register.register((container) => container.addScoped(IHealthCheck, healthCheck));
    return this;
  }

  addHealthCheckFn(func: (resolver: IServiceResolver) => IHealthCheck): IHealthCheckBuilder {
    this.healthCheckBuilders.push(func);
    return this;
  }

  /**
   * Combines the checks registered via `addHealthCheck` (resolved through the registered
   * `IHealthCheckFinder`) with the checks registered via `addHealthCheckFn` (each wrapped as an
   * `InlineHealthCheck` so it is not invoked until the aggregated array is executed). Factory-based
   * checks come first, followed by container-resolved checks - matching the C# order.
   */
  getHealthChecks(resolver: IServiceResolver): IHealthCheck[] {
    const healthCheckFinder = resolver.getService(IHealthCheckFinder);
    const healthChecks = healthCheckFinder.findHealthChecks();
    const inlineHealthChecks = this.healthCheckBuilders.map(
      (build) => new InlineHealthCheck(() => build(resolver).executeAsync()),
    );

    return [...inlineHealthChecks, ...healthChecks];
  }
}

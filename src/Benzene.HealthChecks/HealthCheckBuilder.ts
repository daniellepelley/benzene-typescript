/** Port of Benzene.HealthChecks.HealthCheckBuilder. */
import { InjectableConstructor, IRegisterDependency, IServiceResolver } from '@benzenejs/abstractions';
import { IDependencyHealthCheck, IHealthCheck, IHealthCheckBuilder } from '@benzenejs/health-checks-core';
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
        (resolver) =>
          new HealthCheckFinder(resolver.getServices(IHealthCheck), resolver.getServices(IDependencyHealthCheck)),
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
   * Resolves the registered checks for a probe scope. The builder-local factory checks
   * (`addHealthCheckFn`, each wrapped as an `InlineHealthCheck` so it is not invoked until the
   * aggregated array is executed) and the plain container-registered checks (`addHealthCheck`, via the
   * registered `IHealthCheckFinder`) are always included; the dependency-category checks
   * (`IDependencyHealthCheck`) are included only when `includeDependencyChecks` is `true` — so a
   * liveness or readiness probe never harvests an auto-wired dependency check. Order: factory-based
   * checks first, then plain container checks, then (optionally) dependency-category checks — matching
   * the C# order.
   */
  getHealthChecks(resolver: IServiceResolver, includeDependencyChecks = true): IHealthCheck[] {
    const healthCheckFinder = resolver.getService(IHealthCheckFinder);
    const healthChecks = healthCheckFinder.findHealthChecks();
    const inlineHealthChecks = this.healthCheckBuilders.map(
      (build) => new InlineHealthCheck(() => build(resolver).executeAsync()),
    );

    const combined: IHealthCheck[] = [...inlineHealthChecks, ...healthChecks];
    if (includeDependencyChecks) {
      combined.push(...healthCheckFinder.findDependencyHealthChecks());
    }
    return combined;
  }
}

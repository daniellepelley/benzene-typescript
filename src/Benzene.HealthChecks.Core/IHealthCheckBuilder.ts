/** Port of Benzene.HealthChecks.Core.IHealthCheckBuilder. */
import { InjectableConstructor, IServiceResolver } from '@benzene/abstractions';
import { IHealthCheck } from './IHealthCheck';

/**
 * Fluent builder for registering the set of `IHealthCheck`s a health-check endpoint/topic runs.
 * See `HealthCheckBuilderExtensions` for the additional instance/factory-based helpers layered on
 * top of the members here.
 *
 * C# overload split: the generic `AddHealthCheck<THealthCheck>()` (resolve a type from DI) and
 * `AddHealthCheck(Func<IServiceResolver, IHealthCheck>)` (a resolver function) are both named
 * `AddHealthCheck` in C#. Because a class constructor and a plain function are indistinguishable
 * once TypeScript erases their types, they split by name here: `addHealthCheck` takes the DI-resolved
 * check constructor, `addHealthCheckFn` takes the resolver function.
 */
export interface IHealthCheckBuilder {
  /** Registers a health check, resolving `healthCheck` from the container each time checks run. */
  addHealthCheck(healthCheck: InjectableConstructor<IHealthCheck>): IHealthCheckBuilder;

  /** Registers a health check via a factory function invoked with the current `IServiceResolver` each time checks run. */
  addHealthCheckFn(func: (resolver: IServiceResolver) => IHealthCheck): IHealthCheckBuilder;

  /** Resolves every registered health check against the given resolver. */
  getHealthChecks(resolver: IServiceResolver): IHealthCheck[];
}

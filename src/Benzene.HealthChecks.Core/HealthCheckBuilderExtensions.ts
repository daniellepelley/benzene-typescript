/** Port of Benzene.HealthChecks.Core.HealthCheckBuilderExtensions. */
import { IHealthCheck } from './IHealthCheck';
import { IHealthCheckBuilder } from './IHealthCheckBuilder';
import { IHealthCheckFactory } from './IHealthCheckFactory';

/**
 * Convenience helpers layered on `IHealthCheckBuilder`'s core registration members, for registering
 * an already-constructed instance or an `IHealthCheckFactory` instead of a bare resolver function or
 * a DI-resolved type. C# extension methods become free functions.
 */

/** Registers an already-constructed health check instance, reused on every run. */
export function addHealthCheckInstance(
  source: IHealthCheckBuilder,
  healthCheck: IHealthCheck,
): IHealthCheckBuilder {
  return source.addHealthCheckFn(() => healthCheck);
}

/** Registers multiple already-constructed health check instances, each reused on every run. */
export function addHealthChecks(
  source: IHealthCheckBuilder,
  ...healthChecks: IHealthCheck[]
): IHealthCheckBuilder {
  for (const healthCheck of healthChecks) {
    source.addHealthCheckFn(() => healthCheck);
  }
  return source;
}

/** Registers a health check built via an `IHealthCheckFactory`, invoked with the current resolver each time checks run. */
export function addHealthCheckFactory(
  source: IHealthCheckBuilder,
  healthCheckFactory: IHealthCheckFactory,
): IHealthCheckBuilder {
  return source.addHealthCheckFn((resolver) => healthCheckFactory.create(resolver));
}

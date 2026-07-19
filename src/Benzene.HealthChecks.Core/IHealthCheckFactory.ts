/** Port of Benzene.HealthChecks.Core.IHealthCheckFactory. */
import { IServiceResolver } from '@benzene/abstractions';
import { IHealthCheck } from './IHealthCheck';

/**
 * Builds an `IHealthCheck` instance, given constructor arguments that aren't themselves resolved
 * from DI (e.g. a URL, a target migration name) - see `HttpPingHealthCheckFactory` for the pattern
 * this exists to support, layered on top via `addHealthCheckFactory`.
 */
export interface IHealthCheckFactory {
  /** Creates the health check, resolving any of its dependencies from `resolver`. */
  create(resolver: IServiceResolver): IHealthCheck;
}

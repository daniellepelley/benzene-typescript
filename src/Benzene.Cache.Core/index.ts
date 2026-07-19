export * from './ICacheService';
export * from './ICacheInvalidateActions';
export * from './ICacheWriteActions';
export * from './ICacheEntry';
export * from './CacheUpdateAction';
export * from './CacheInvalidateActions';
export * from './CacheWriteActions';
export * from './CacheEntry';

/*
 * Deferred: CacheHealthCheck / CacheHealthCheckFactory / Extensions (AddCacheHealthCheck).
 *
 * These C# types depend on `Benzene.HealthChecks.Core` (`IHealthCheck`, `IHealthCheckResult`,
 * `HealthCheckResult`, `HealthCheckDependency`, `IHealthCheckFactory`, `IHealthCheckBuilder`),
 * which is not yet ported — health checks are a distinct future workstream in the port roadmap
 * (the outbound clients + health-checks slice). Rather than fork a partial, soon-to-diverge copy of
 * that abstraction into this package, the cache health check is deferred until
 * `Benzene.HealthChecks.Core` is ported, at which point it can be added here faithfully.
 */

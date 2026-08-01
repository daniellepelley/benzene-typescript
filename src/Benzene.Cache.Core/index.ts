export * from './ICacheService';
export * from './ICacheInvalidateActions';
export * from './ICacheWriteActions';
export * from './ICacheEntry';
export * from './CacheUpdateAction';
export * from './CacheInvalidateActions';
export * from './CacheWriteActions';
export * from './CacheEntry';

/*
 * Deferred: CacheHealthCheck / CacheHealthCheckFactory / Extensions (addCacheHealthCheck).
 *
 * The abstraction these build on — `@benzene/health-checks-core` (`IHealthCheck`,
 * `IHealthCheckResult`, `HealthCheckResult`, `IHealthCheckFactory`, `IHealthCheckBuilder`) — is now
 * ported, so the original blocker is gone; only the cache health-check wrapper itself has yet to be
 * ported (it can now be added here faithfully). Until then, wire a readiness probe to
 * `ICacheService.canConnectAsync()` directly (see docs/caching.md).
 */

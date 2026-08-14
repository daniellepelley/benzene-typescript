/** Port of Benzene.Cache.Core.Extensions (the cache health-check registration helper). */
import { addHealthCheckFactory, IHealthCheckBuilder } from '@benzenejs/health-checks-core';
import { CacheHealthCheckFactory } from './CacheHealthCheckFactory';

/**
 * Registers a {@link CacheHealthCheck} that reports whether the registered `ICacheService`'s cache is
 * reachable. C# extension method → free function taking the builder first. The C#'s
 * `AddCacheHealthCheck<TCacheService>()` type argument collapses to the single `ICacheService` token the
 * port registers cache services under.
 */
export function addCacheHealthCheck(builder: IHealthCheckBuilder): IHealthCheckBuilder {
  return addHealthCheckFactory(builder, new CacheHealthCheckFactory());
}

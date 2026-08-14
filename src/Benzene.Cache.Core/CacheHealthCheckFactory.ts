/** Port of Benzene.Cache.Core.CacheHealthCheckFactory. */
import { IServiceResolver } from '@benzenejs/abstractions';
import { IHealthCheck, IHealthCheckFactory } from '@benzenejs/health-checks-core';
import { CacheHealthCheck } from './CacheHealthCheck';
import { ICacheService } from './ICacheService';

/**
 * Builds a {@link CacheHealthCheck} by resolving the registered {@link ICacheService} from the container
 * each time the check runs — faithful to the C# factory's `resolver.GetService<TCacheService>()` (the port
 * resolves the single `ICacheService` token rather than a generic type argument, and does not resolve a
 * logger; see {@link CacheHealthCheck}).
 */
export class CacheHealthCheckFactory implements IHealthCheckFactory {
  create(resolver: IServiceResolver): IHealthCheck {
    return new CacheHealthCheck(resolver.getService(ICacheService));
  }
}

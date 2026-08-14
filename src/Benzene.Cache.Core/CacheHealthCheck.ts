/** Port of Benzene.Cache.Core.CacheHealthCheck. */
import {
  HealthCheckDependency,
  HealthCheckResult,
  IHealthCheck,
  IHealthCheckResult,
} from '@benzenejs/health-checks-core';
import { ICacheService } from './ICacheService';

/**
 * Reports whether the cache backing an {@link ICacheService} is reachable, via
 * `ICacheService.canConnectAsync()` (for `RedisCacheService`, a Redis `PING`).
 *
 * The C# generic `CacheHealthCheck<TCacheService>` collapses here: TypeScript erases the type argument and
 * the port registers cache services under the single `ICacheService` token, so the check just takes the
 * resolved service. The dependency label defaults to the concrete service's class name (the JS analog of
 * `typeof(TCacheService).Name`).
 *
 * DIVERGENCE: the C# check also logs the failure via `ILogger`; the port omits the logger and surfaces the
 * failure's type name under `data.Error` instead, consistent with the other health checks (Tcp / DynamoDb),
 * which take no logger. As everywhere in the health checks, the error *type* is reported, never its message.
 */
export class CacheHealthCheck implements IHealthCheck {
  constructor(
    private readonly cacheService: ICacheService,
    private readonly name: string = cacheService.constructor?.name ?? 'Cache',
  ) {}

  get type(): string {
    return 'Cache';
  }

  async executeAsync(): Promise<IHealthCheckResult> {
    const dependencies = [new HealthCheckDependency('Cache', this.name)];

    try {
      const canConnect = await this.cacheService.canConnectAsync();
      return HealthCheckResult.createInstance(canConnect, this.type, { CanConnect: canConnect }, dependencies);
    } catch (error) {
      return HealthCheckResult.createInstance(
        false,
        this.type,
        { CanConnect: false, Error: errorName(error) },
        dependencies,
      );
    }
  }
}

/** Mirrors C#'s `ex.GetType().Name` — the thrown value's constructor name (never its message). */
function errorName(error: unknown): string {
  if (error instanceof Error) {
    return error.constructor?.name ?? error.name;
  }
  return typeof error;
}

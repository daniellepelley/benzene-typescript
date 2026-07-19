/** Port of Benzene.Cache.Redis.RedisWildcardActions. */
import { ILogger } from '@benzene/abstractions';
import { CacheInvalidateActions } from '@benzene/cache-core';
import type { RedisCacheService } from './RedisCacheService';

/**
 * Invalidates every Redis key matching a glob-style pattern: fetches the matching keys, then deletes
 * them in batches. Port of Benzene.Cache.Redis.RedisWildcardActions (C# `internal` → exported here).
 *
 * StackExchange.Redis → ioredis mapping: the C# `IDatabase.ExecuteAsync("KEYS", pattern)` raw command
 * becomes ioredis `keys(pattern)` (`KEYS`); `KeyDeleteAsync(keys[])` becomes `del(...batch)` (`DEL`).
 * The C# batch size (`MaxKeyForDelete = 1_048_000`) is preserved. Returns `true` when at least one key
 * was deleted; backend errors are caught and logged, matching the C# behaviour.
 *
 * Note (carried over from the C#): `KEYS` scans the whole keyspace and can block Redis on large
 * datasets — a faithful port of the original, not a recommendation.
 */
export class RedisWildcardActions extends CacheInvalidateActions {
  private static readonly maxKeyForDelete = 1048000;

  private readonly service: RedisCacheService;
  private readonly pattern: string;

  constructor(redisCacheService: RedisCacheService, pattern: string) {
    super();
    this.service = redisCacheService;
    this.pattern = pattern;
  }

  protected get logger(): ILogger {
    return this.service.logger;
  }

  protected get keyDescription(): string {
    return this.pattern;
  }

  protected async invalidateEntryAsync(): Promise<boolean> {
    let deletedKeys = 0;
    try {
      const redisClient = await this.service.redisSetup();
      this.logger.logDebug(`Sending ${this.pattern} search to cache`);
      const result = await redisClient.keys(this.pattern);
      this.logger.logDebug(`BenzeneResult for ${this.pattern} - ${result.length} keys.`);
      for (let i = 0; i < result.length; i += RedisWildcardActions.maxKeyForDelete) {
        const keysForSending = result.slice(i, i + RedisWildcardActions.maxKeyForDelete);
        this.logger.logDebug(`Deleting batch of ${keysForSending.length} keys.`);
        deletedKeys += await redisClient.del(...keysForSending);
      }
      this.logger.logDebug(`Deleted ${deletedKeys} keys.`);
    } catch {
      this.logger.logWarning('Error deleting keys from cache');
    }
    return deletedKeys > 0;
  }
}

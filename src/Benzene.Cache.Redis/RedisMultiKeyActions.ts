/** Port of Benzene.Cache.Redis.RedisMultiKeyActions. */
import { ILogger } from '@benzene/abstractions';
import { CacheWriteActions } from '@benzene/cache-core';
import type { RedisCacheService } from './RedisCacheService';

/**
 * Write/invalidate actions applied across several Redis keys at once (the same serialized value is
 * written to each). Port of Benzene.Cache.Redis.RedisMultiKeyActions&lt;T&gt; (C# `internal` →
 * exported here).
 *
 * StackExchange.Redis → ioredis mapping mirrors {@link RedisCacheEntry}, looping the keys:
 * `StringSetAsync` → `set(key, val, 'EX', seconds)`, `KeyDeleteAsync` → `del`. Returns `true` when at
 * least one key was written/deleted; backend errors are caught and logged, matching the C# behaviour.
 */
export class RedisMultiKeyActions<T> extends CacheWriteActions<T> {
  private readonly service: RedisCacheService;
  private readonly keys: string[];

  constructor(redisCacheService: RedisCacheService, keys: Iterable<string>) {
    super();
    this.service = redisCacheService;
    this.keys = [...keys];
  }

  protected get logger(): ILogger {
    return this.service.logger;
  }

  protected get keyDescription(): string {
    return this.keys.join(', ');
  }

  protected async invalidateEntryAsync(): Promise<boolean> {
    let deletedKeys = 0;
    try {
      const redisClient = await this.service.redisSetup();
      for (const key of this.keys) {
        if ((await redisClient.del(key)) > 0) {
          deletedKeys++;
        }
      }
    } catch {
      this.logger.logWarning('Error deleting keys from cache');
    }
    return deletedKeys > 0;
  }

  protected async setEntryValueAsync(value: string, expireIn: number | undefined): Promise<boolean> {
    let updatedKeys = 0;
    try {
      const redisClient = await this.service.redisSetup();
      const ttlSeconds = Math.ceil((expireIn ?? this.service.defaultCacheLifespan) / 1000);
      for (const key of this.keys) {
        if ((await redisClient.set(key, value, 'EX', ttlSeconds)) === 'OK') {
          updatedKeys++;
        }
      }
    } catch {
      this.logger.logWarning('Error setting value in cache');
    }
    return updatedKeys > 0;
  }
}

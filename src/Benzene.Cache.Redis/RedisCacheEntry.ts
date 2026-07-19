/** Port of Benzene.Cache.Redis.RedisCacheEntry. */
import { ILogger } from '@benzene/abstractions';
import { CacheEntry } from '@benzene/cache-core';
import type { RedisCacheService } from './RedisCacheService';

/**
 * Redis-backed single cache entry. Reads/writes/deletes one key against the service's ioredis
 * client. Port of Benzene.Cache.Redis.RedisCacheEntry&lt;T&gt; (C# `internal` → exported here).
 *
 * StackExchange.Redis → ioredis mapping: `StringGetAsync` → `get`; `StringSetAsync(key, val, ttl)`
 * → `set(key, val, 'EX', seconds)`; `KeyDeleteAsync` → `del`. The TTL `TimeSpan` becomes whole
 * seconds for `SET ... EX` (C# passes the `TimeSpan` straight through). As in C#, backend errors are
 * caught and logged as warnings, with `getEntryValueAsync` returning `''` and the write/delete hooks
 * returning `false`.
 */
export class RedisCacheEntry<T> extends CacheEntry<T> {
  private readonly service: RedisCacheService;
  private readonly key: string;

  constructor(redisCacheService: RedisCacheService, key: string) {
    super();
    this.service = redisCacheService;
    this.key = key;
  }

  protected get logger(): ILogger {
    return this.service.logger;
  }

  protected get keyDescription(): string {
    return this.key;
  }

  protected async getEntryValueAsync(): Promise<string | undefined> {
    try {
      const redisClient = await this.service.redisSetup();
      const value = await redisClient.get(this.key);
      return value ?? undefined;
    } catch {
      this.logger.logWarning('Error getting value from cache');
      return '';
    }
  }

  protected async setEntryValueAsync(value: string, expireIn: number | undefined): Promise<boolean> {
    try {
      const redisClient = await this.service.redisSetup();
      const ttlSeconds = Math.ceil((expireIn ?? this.service.defaultCacheLifespan) / 1000);
      const result = await redisClient.set(this.key, value, 'EX', ttlSeconds);
      return result === 'OK';
    } catch {
      this.logger.logWarning('Error setting value in cache');
      return false;
    }
  }

  protected async invalidateEntryAsync(): Promise<boolean> {
    try {
      const redisClient = await this.service.redisSetup();
      const deleted = await redisClient.del(this.key);
      return deleted > 0;
    } catch {
      this.logger.logWarning('Error deleting key from cache');
      return false;
    }
  }
}

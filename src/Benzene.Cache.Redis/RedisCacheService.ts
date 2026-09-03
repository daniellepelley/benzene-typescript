/** Port of Benzene.Cache.Redis.RedisCacheService. */
import type { RedisOptions } from 'ioredis';
import { ILogger } from '@benzenejs/abstractions';
import {
  ICacheEntry,
  ICacheInvalidateActions,
  ICacheService,
  ICacheWriteActions,
} from '@benzenejs/cache-core';
import { IRedisConnectionFactory, RedisClient } from './IRedisConnectionFactory';
import { RedisCacheEntry } from './RedisCacheEntry';
import { RedisMultiKeyActions } from './RedisMultiKeyActions';
import { RedisWildcardActions } from './RedisWildcardActions';

/**
 * Abstract Redis-backed {@link ICacheService}. Holds a single lazily-established ioredis connection
 * and is the factory for the cache-action objects (entry / multi-key / prefix / wildcard). Concrete
 * subclasses supply the connection options via {@link getConfigurationOptionsAsync}.
 * Port of Benzene.Cache.Redis.RedisCacheService.
 *
 * Adaptations:
 * - StackExchange.Redis `IConnectionMultiplexer`/`IDatabase` → a single ioredis {@link RedisClient};
 *   .NET's `multiplexer.GetDatabase()` has no ioredis equivalent (the client *is* the database), so
 *   {@link redisSetup} returns the connected client directly.
 * - The C# `Lazy<Task<IConnectionMultiplexer>>` (connect-once) is reproduced with a cached promise.
 * - The constructor's `IProcessTimerFactory` parameter and the `RedisCacheService_Connect` timing
 *   scope are dropped — the process-timer surface is deferred in the port.
 * - `DefaultCacheLifespan` (`TimeSpan.FromMinutes(5)`) → `defaultCacheLifespan` in **milliseconds**
 *   (300_000), overridable by subclasses; the Redis layer converts it to whole seconds for `SET EX`.
 */
export abstract class RedisCacheService implements ICacheService {
  readonly logger: ILogger;

  private readonly connectionFactory: IRedisConnectionFactory;
  private redisConnection?: Promise<RedisClient>;

  /** Port of C# `virtual TimeSpan DefaultCacheLifespan => TimeSpan.FromMinutes(5)`, in milliseconds. */
  get defaultCacheLifespan(): number {
    return 5 * 60 * 1000;
  }

  protected constructor(logger: ILogger, connectionFactory: IRedisConnectionFactory) {
    this.logger = logger;
    this.connectionFactory = connectionFactory;
  }

  protected abstract getConfigurationOptionsAsync(): Promise<RedisOptions>;

  private connect(): Promise<RedisClient> {
    if (this.redisConnection === undefined) {
      this.redisConnection = (async () => {
        const options = await this.getConfigurationOptionsAsync();
        if (options === undefined || options === null) {
          throw new Error('Redis configuration options are not set');
        }
        return this.connectionFactory.connectAsync(options);
      })();
    }
    return this.redisConnection;
  }

  /** Port of C# `protected void StartConnection()` — eagerly triggers the lazy connection. */
  protected startConnection(): void {
    void this.connect();
  }

  /** Port of C# `internal Task<IDatabase> RedisSetup()`. Returns the connected client. */
  redisSetup(): Promise<RedisClient> {
    return this.connect();
  }

  async canConnectAsync(): Promise<boolean> {
    const redisClient = await this.redisSetup();
    await redisClient.ping();
    return true;
  }

  protected createCacheEntry<T>(key: string): ICacheEntry<T> {
    return new RedisCacheEntry<T>(this, key);
  }

  protected createMultiKeyActions<T>(keys: Iterable<string>): ICacheWriteActions<T> {
    return new RedisMultiKeyActions<T>(this, keys);
  }

  protected createPrefixActions(prefix: string): ICacheInvalidateActions {
    // The C# #198 guard: an empty/whitespace prefix used to append into the bare pattern "*" -
    // every key in the logical database, deleted in batches. That is almost certainly a caller-side
    // bug (e.g. an empty tenant id interpolated into the prefix), and it is exactly the kind of
    // mistake that must fail loudly rather than silently wiping the cache. If invalidate-everything
    // is genuinely intended, there is an explicit, unambiguous route for it -
    // createWildcardActions('*') - so this refuses to guess which one was meant.
    if (prefix.trim().length === 0) {
      throw new Error(
        'An empty/whitespace prefix would invalidate every key (the pattern "*"). ' +
          'If invalidating everything is genuinely what you want, call ' +
          "createWildcardActions('*') instead, which makes that intent explicit.",
      );
    }

    // Escape glob metacharacters in the LITERAL prefix before appending the wildcard. Redis KEYS
    // treats * ? [ ] \ as glob syntax, so a prefix derived from data (tenant id, email, ...) that
    // contains one would otherwise match the wrong keys - under-invalidating (an unterminated "["
    // matches nothing, leaving stale data) or over-invalidating (a "*" matches unrelated keys).
    // createWildcardActions is left unescaped by design: its caller is passing an actual pattern.
    return new RedisWildcardActions(this, escapeGlobLiteral(prefix) + '*');
  }

  protected createWildcardActions(pattern: string): ICacheInvalidateActions {
    return new RedisWildcardActions(this, pattern);
  }
}

/** Port of C# `RedisCacheService.EscapeGlobLiteral`. */
function escapeGlobLiteral(value: string): string {
  return value.replace(/[\\*?[\]]/g, (c) => '\\' + c);
}

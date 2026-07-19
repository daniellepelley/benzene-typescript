/** Port of Benzene.Cache.Redis.IRedisConnectionFactory. */
import type { RedisOptions } from 'ioredis';
import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * The subset of the ioredis `Redis` client surface the cache adapter uses. Declaring our own
 * structural type (rather than importing ioredis's `Redis`) keeps the dependency at exactly the
 * commands we touch and, crucially, lets tests inject a plain fake object implementing just these
 * five methods without having to satisfy the full `Redis` class. A real ioredis `Redis` instance is
 * structurally assignable to this type (see {@link RedisConnectionFactory}).
 *
 * StackExchange.Redis → ioredis command mapping:
 * - `IDatabase.StringGetAsync(key)`            → `get(key)`            (`GET`)
 * - `IDatabase.StringSetAsync(key, val, ttl)`  → `set(key, val, 'EX', seconds)` (`SET ... EX`)
 * - `IDatabase.KeyDeleteAsync(key/keys)`       → `del(...keys)`        (`DEL`)
 * - `IDatabase.ExecuteAsync("KEYS", pattern)`  → `keys(pattern)`       (`KEYS`)
 * - `IDatabase.PingAsync()`                    → `ping()`              (`PING`)
 */
export interface RedisClient {
  /** `GET key`. Returns the stored string, or `null` when the key is absent. */
  get(key: string): Promise<string | null>;

  /** `SET key value EX seconds`. Returns `'OK'` on success. */
  set(key: string, value: string, expiryMode: 'EX', ttlSeconds: number): Promise<'OK' | null>;

  /** `DEL key [key ...]`. Returns the number of keys removed. */
  del(...keys: string[]): Promise<number>;

  /** `KEYS pattern`. Returns every key matching the glob-style pattern. */
  keys(pattern: string): Promise<string[]>;

  /** `PING`. Returns `'PONG'` when the connection is healthy. */
  ping(): Promise<string>;
}

/**
 * Creates a connected Redis client from connection options.
 * Port of Benzene.Cache.Redis.IRedisConnectionFactory.
 *
 * Adaptation: .NET returns `IConnectionMultiplexer` (from `StackExchange.Redis`) and takes a
 * `ConfigurationOptions`; here the client is an ioredis {@link RedisClient} created from ioredis
 * `RedisOptions`. Resolved from the container in .NET, so it declares a merged `ServiceToken`.
 */
export interface IRedisConnectionFactory {
  /** Port of C# `Task<IConnectionMultiplexer> ConnectAsync(ConfigurationOptions options)`. */
  connectAsync(options: RedisOptions): Promise<RedisClient>;
}

export const IRedisConnectionFactory: ServiceToken<IRedisConnectionFactory> =
  serviceToken<IRedisConnectionFactory>('IRedisConnectionFactory');

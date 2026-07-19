/** Port of Benzene.Cache.Redis.RedisConnectionFactory. */
import { Redis, type RedisOptions } from 'ioredis';
import { IRedisConnectionFactory, RedisClient } from './IRedisConnectionFactory';

/**
 * Default {@link IRedisConnectionFactory}: opens a real ioredis connection.
 * Port of Benzene.Cache.Redis.RedisConnectionFactory.
 *
 * Adaptation: C# calls `ConnectionMultiplexer.ConnectAsync(options)` (async, returns
 * `IConnectionMultiplexer`). ioredis connects when the client is constructed (`new Redis(options)`,
 * lazily/eagerly depending on `lazyConnect`), so there is no async connect call to await; the client
 * is returned directly. The concrete `Redis` instance is narrowed to the adapter's structural
 * {@link RedisClient} view at this single boundary.
 */
export class RedisConnectionFactory implements IRedisConnectionFactory {
  connectAsync(options: RedisOptions): Promise<RedisClient> {
    const client = new Redis(options);
    return Promise.resolve(client as unknown as RedisClient);
  }
}

/**
 * Port-style tests for Benzene.Cache.Redis, driven entirely through a FAKE ioredis client (a plain
 * object implementing get/set/del/keys/ping) injected via a fake IRedisConnectionFactory — no real
 * Redis server is involved.
 */
import { describe, expect, it, vi } from 'vitest';
import type { RedisOptions } from 'ioredis';
import { ILogger, NullLogger } from '@benzene/abstractions';
import { ICacheEntry, ICacheInvalidateActions, ICacheWriteActions } from '@benzene/cache-core';
import {
  IRedisConnectionFactory,
  RedisCacheService,
  RedisClient,
} from '@benzene/cache-redis';

interface Widget {
  id: string;
  name: string;
}

const widget: Widget = { id: '1', name: 'sprocket' };

/** In-memory fake of the five-method ioredis surface the adapter uses, with spied methods. */
function createFakeRedis(store = new Map<string, string>()) {
  const globToRegExp = (pattern: string): RegExp =>
    new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

  const client: RedisClient = {
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: vi.fn((key: string, value: string, _mode: 'EX', _ttl: number) => {
      store.set(key, value);
      return Promise.resolve<'OK' | null>('OK');
    }),
    del: vi.fn((...keys: string[]) => {
      let removed = 0;
      for (const key of keys) {
        if (store.delete(key)) {
          removed++;
        }
      }
      return Promise.resolve(removed);
    }),
    keys: vi.fn((pattern: string) => {
      const re = globToRegExp(pattern);
      return Promise.resolve([...store.keys()].filter((k) => re.test(k)));
    }),
    ping: vi.fn(() => Promise.resolve('PONG')),
  };

  return { client, store };
}

function fakeFactory(client: RedisClient): IRedisConnectionFactory {
  return { connectAsync: vi.fn(() => Promise.resolve(client)) };
}

/** Concrete RedisCacheService exposing the protected factory hooks for testing. */
class TestRedisCacheService extends RedisCacheService {
  constructor(logger: ILogger, connectionFactory: IRedisConnectionFactory) {
    super(logger, connectionFactory);
  }

  protected getConfigurationOptionsAsync(): Promise<RedisOptions> {
    return Promise.resolve({} as RedisOptions);
  }

  entry<T>(key: string): ICacheEntry<T> {
    return this.createCacheEntry<T>(key);
  }

  multiKey<T>(keys: Iterable<string>): ICacheWriteActions<T> {
    return this.createMultiKeyActions<T>(keys);
  }

  prefix(prefix: string): ICacheInvalidateActions {
    return this.createPrefixActions(prefix);
  }

  wildcard(pattern: string): ICacheInvalidateActions {
    return this.createWildcardActions(pattern);
  }
}

function createService(fake = createFakeRedis()) {
  const service = new TestRedisCacheService(NullLogger.instance, fakeFactory(fake.client));
  return { service, ...fake };
}

describe('RedisCacheService (cache-redis)', () => {
  it('canConnectAsync pings the client and reflects a healthy connection', async () => {
    const { service, client } = createService();

    expect(await service.canConnectAsync()).toBe(true);
    expect(client.ping).toHaveBeenCalledTimes(1);
  });

  it('canConnectAsync propagates a failing ping', async () => {
    const fake = createFakeRedis();
    (fake.client.ping as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('no route to host'));
    const { service } = createService(fake);

    await expect(service.canConnectAsync()).rejects.toThrow('no route to host');
  });

  it('connects once and reuses the connection across calls', async () => {
    const fake = createFakeRedis();
    const factory = fakeFactory(fake.client);
    class OnceService extends TestRedisCacheService {}
    const service = new OnceService(NullLogger.instance, factory);

    await service.canConnectAsync();
    await service.canConnectAsync();

    expect(factory.connectAsync).toHaveBeenCalledTimes(1);
  });
});

describe('RedisCacheEntry (cache-redis)', () => {
  it('round-trips a value through the fake get/set with the right key and TTL', async () => {
    const { service, client, store } = createService();
    const entry = service.entry<Widget>('widget:1');

    expect(await entry.setValueAsync(widget)).toBe(true);
    // SET key value EX <defaultCacheLifespan-in-seconds = 300>
    expect(client.set).toHaveBeenCalledWith('widget:1', JSON.stringify(widget), 'EX', 300);
    expect(store.get('widget:1')).toBe(JSON.stringify(widget));

    const read = await entry.getValueAsync();
    expect(client.get).toHaveBeenCalledWith('widget:1');
    expect(read).toEqual(widget);
  });

  it('honours an explicit expireIn (ms) converted to whole seconds for SET EX', async () => {
    const { service, client } = createService();
    const entry = service.entry<Widget>('widget:1');

    await entry.setValueAsync(widget, 30_000);

    expect(client.set).toHaveBeenCalledWith('widget:1', JSON.stringify(widget), 'EX', 30);
  });

  it('getValueAsync returns undefined on a miss', async () => {
    const { service } = createService();

    expect(await service.entry<Widget>('absent').getValueAsync()).toBeUndefined();
  });

  it('invalidateAsync deletes the key', async () => {
    const fake = createFakeRedis(new Map([['widget:1', JSON.stringify(widget)]]));
    const { service, client, store } = createService(fake);

    expect(await service.entry<Widget>('widget:1').invalidateAsync()).toBe(true);
    expect(client.del).toHaveBeenCalledWith('widget:1');
    expect(store.has('widget:1')).toBe(false);
  });
});

describe('RedisMultiKeyActions (cache-redis)', () => {
  it('sets every key and reports success', async () => {
    const { service, client, store } = createService();
    const actions = service.multiKey<Widget>(['a', 'b']);

    expect(await actions.setValueAsync(widget)).toBe(true);
    expect(client.set).toHaveBeenCalledWith('a', JSON.stringify(widget), 'EX', 300);
    expect(client.set).toHaveBeenCalledWith('b', JSON.stringify(widget), 'EX', 300);
    expect(store.get('a')).toBe(JSON.stringify(widget));
    expect(store.get('b')).toBe(JSON.stringify(widget));
  });

  it('invalidates every key', async () => {
    const fake = createFakeRedis(
      new Map([
        ['a', '1'],
        ['b', '2'],
      ]),
    );
    const { service, store } = createService(fake);

    expect(await service.multiKey<Widget>(['a', 'b']).invalidateAsync()).toBe(true);
    expect(store.size).toBe(0);
  });
});

describe('RedisWildcardActions (cache-redis)', () => {
  it('invalidates by pattern via keys + del', async () => {
    const fake = createFakeRedis(
      new Map([
        ['widget:1', 'a'],
        ['widget:2', 'b'],
        ['gadget:1', 'c'],
      ]),
    );
    const { service, client, store } = createService(fake);

    const result = await service.wildcard('widget:*').invalidateAsync();

    expect(result).toBe(true);
    expect(client.keys).toHaveBeenCalledWith('widget:*');
    expect(client.del).toHaveBeenCalledTimes(1);
    expect(store.has('widget:1')).toBe(false);
    expect(store.has('widget:2')).toBe(false);
    expect(store.has('gadget:1')).toBe(true);
  });

  it('createPrefixActions appends the trailing wildcard', async () => {
    const fake = createFakeRedis(
      new Map([
        ['widget:1', 'a'],
        ['gadget:1', 'c'],
      ]),
    );
    const { service, client, store } = createService(fake);

    await service.prefix('widget:').invalidateAsync();

    expect(client.keys).toHaveBeenCalledWith('widget:*');
    expect(store.has('widget:1')).toBe(false);
    expect(store.has('gadget:1')).toBe(true);
  });

  it('returns false when no keys match the pattern', async () => {
    const { service, client } = createService();

    expect(await service.wildcard('none:*').invalidateAsync()).toBe(false);
    expect(client.del).not.toHaveBeenCalled();
  });
});

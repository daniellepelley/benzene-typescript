# Cache Handler Responses with Redis

Use `@benzene/cache-redis` to cache expensive reads behind a message handler, and keep the cache correct
on writes and deletes.

## Problem Statement

You have a message handler that reads from a slow or rate-limited downstream (a database, a third-party
API) on every request. You want to:

- Serve repeated reads from Redis instead of hitting the downstream every time.
- Automatically refresh the cache when the underlying data changes.
- Explicitly invalidate the cache when a record is deleted.
- Do all of this without hand-writing "check cache, then call downstream, then update cache" boilerplate
  in every handler.

This cookbook builds a small product catalog on top of the caching abstractions described in
[Caching](../caching.md) — read that first if you haven't; it's the reference doc for
`@benzene/cache-core`/`@benzene/cache-redis` and covers every member in detail. This cookbook is the
worked example on top of it: a full read/write/invalidate cycle wired into real message handlers.

> **Port note — Redis client.** The .NET `Benzene.Cache.Redis` wraps `StackExchange.Redis`. Per the
> port's [third-party-integration convention](../../README.md#porting-conventions), the TypeScript port is
> an adapter over [`ioredis`](https://github.com/redis/ioredis), the popular Node Redis client. The
> abstraction core (`@benzene/cache-core`) is a straight port; only the Redis layer is re-implemented.
> There is **no `IProcessTimerFactory` dependency** to satisfy in the port — the process-timer surface is
> deferred, so unlike the .NET version, your cache service subclass constructs with just an `ILogger` and
> an `IRedisConnectionFactory`.

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and a Benzene service using `@benzene/core-message-handlers`
  (message handlers returning `IBenzeneResultOf<T>`) — see [AWS Lambda Setup](../getting-started-aws.md)
  if you don't have one yet.
- A reachable Redis instance (a local Docker container is enough for development — see
  [Testing](#testing) below).

## Installation

```bash
npm install @benzene/cache-core @benzene/cache-redis ioredis
```

`@benzene/cache-redis` depends on `@benzene/cache-core` and `ioredis` directly — no other runtime
dependencies are pulled in.

## Step-by-Step Implementation

### 1. Define the port and a Redis-backed cache service

The repository/API you're caching in front of is a port — an interface your handlers depend on,
implemented by whatever actually talks to your database. Give it a merged `ServiceToken` so the container
can resolve it (the port's convention for anything injected — see [Message Handlers](../message-handlers.md)):

```ts
// ProductRepository.ts
import { IBenzeneResultOf, ServiceToken, VoidResult, serviceToken } from '@benzene/abstractions';

export class Product {
  id?: string;
  name?: string;
  priceInCents = 0;
}

export class UpdateProduct {
  productId?: string;
  name?: string;
  priceInCents = 0;
}

export interface IProductRepository {
  getAsync(productId: string): Promise<IBenzeneResultOf<Product>>;
  updateAsync(productId: string, request: UpdateProduct): Promise<IBenzeneResultOf<Product>>;
  deleteAsync(productId: string): Promise<IBenzeneResultOf<VoidResult>>;
}

export const IProductRepository: ServiceToken<IProductRepository> =
  serviceToken<IProductRepository>('IProductRepository');
```

Subclass `RedisCacheService` and expose a typed `ICacheEntry<T>` for the key(s) you want to cache.
`getConfigurationOptionsAsync()` is the only member you're required to implement — everything else
(serialization, TTL, lazy-load/write-through orchestration) is handled for you by the base class. It
returns an `ioredis` [`RedisOptions`](https://github.com/redis/ioredis); `ioredis` connects when the
client is constructed, so there's no separate async connect call to await:

```ts
// ProductCacheService.ts
import type { RedisOptions } from 'ioredis';
import { ILogger } from '@benzene/abstractions';
import { ICacheEntry } from '@benzene/cache-core';
import { IRedisConnectionFactory, RedisCacheService } from '@benzene/cache-redis';
import { Product } from './ProductRepository.js';

export class ProductCacheService extends RedisCacheService {
  static readonly inject = [ILogger, IRedisConnectionFactory] as const;

  constructor(logger: ILogger, connectionFactory: IRedisConnectionFactory) {
    super(logger, connectionFactory);
    this.startConnection(); // warm the (lazy) connection on construction
  }

  // Override the default 5-minute TTL (300_000 ms) used by setValueAsync calls without an explicit expireIn.
  override get defaultCacheLifespan(): number {
    return 10 * 60 * 1000; // 10 minutes, in milliseconds
  }

  protected getConfigurationOptionsAsync(): Promise<RedisOptions> {
    const [host, port] = (process.env.REDIS_URL ?? 'localhost:6379').split(':');
    return Promise.resolve({ host, port: Number(port ?? 6379) });
  }

  getProductEntry(productId: string): ICacheEntry<Product> {
    return this.createCacheEntry<Product>(`product:${productId}`);
  }
}
```

> **Durations are milliseconds.** The .NET `DefaultCacheLifespan` `TimeSpan` and the `TimeSpan? expireIn`
> parameters become plain `number` values in **milliseconds** — the port's standard duration unit. The
> Redis layer converts the effective lifespan to whole seconds for `SET ... EX` (so `600_000` ms →
> `EX 600`). Override the `defaultCacheLifespan` **getter** to change the default.

### 2. Register services

Register the default `IRedisConnectionFactory` (`RedisConnectionFactory`, which opens a real `ioredis`
connection), your cache service, and the repository. This example hosts the handlers on AWS Lambda behind
API Gateway; the registration is identical on any host (see [Hosting](../hosting.md)):

```ts
// index.ts
import { addBenzene, useMessageHandlers } from '@benzene/core-message-handlers';
import { InlineAwsLambdaStartUp, toLambdaHandler } from '@benzene/aws-lambda-core';
import { useApiGateway } from '@benzene/aws-lambda-api-gateway';
import { IRedisConnectionFactory, RedisConnectionFactory } from '@benzene/cache-redis';
import { ProductCacheService } from './ProductCacheService.js';
import { IProductRepository } from './ProductRepository.js';
import { SqlProductRepository } from './SqlProductRepository.js';
import { GetProductHandler, UpdateProductHandler, DeleteProductHandler } from './handlers.js';

const entryPoint = new InlineAwsLambdaStartUp()
  .configureServices((services) => {
    addBenzene(services);
    services.addScoped(IRedisConnectionFactory, RedisConnectionFactory);
    services.addScoped(ProductCacheService);
    services.addScoped(IProductRepository, SqlProductRepository);
  })
  .configure((app) =>
    useApiGateway(app, (api) =>
      useMessageHandlers(api, GetProductHandler, UpdateProductHandler, DeleteProductHandler),
    ),
  )
  .build();

export const handler = toLambdaHandler(entryPoint);
```

Nothing here is cache-specific — caching in Benzene isn't a middleware you add to a pipeline (see
[Caching: Overview](../caching.md#overview)). `ProductCacheService` is consumed directly by the handlers
below through constructor injection, the same as any other dependency.

### 3. Read-through: check the cache before doing expensive work

`lazyLoadAsync` checks the cache first; on a miss, it calls your `databaseReadFunc`, and — if that result
`isSuccessful` — stores the payload back in the cache before returning it:

```ts
// handlers.ts
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { ProductCacheService } from './ProductCacheService.js';
import { IProductRepository, Product } from './ProductRepository.js';

export class GetProductRequest {
  productId?: string;
}

@httpEndpoint('GET', '/products/{productId}')
@message('products:get', { requestType: GetProductRequest, responseType: Product })
export class GetProductHandler implements IMessageHandler<GetProductRequest, Product> {
  static readonly inject = [ProductCacheService, IProductRepository] as const;

  constructor(
    private readonly cache: ProductCacheService,
    private readonly products: IProductRepository,
  ) {}

  handleAsync(request: GetProductRequest): Promise<IBenzeneResultOf<Product>> {
    const entry = this.cache.getProductEntry(request.productId!);
    return entry.lazyLoadAsync(() => this.products.getAsync(request.productId!));
  }
}
```

The first request for a given `productId` misses, calls `IProductRepository.getAsync`, and caches the
result. Every request after that (until the 10-minute TTL from `defaultCacheLifespan` expires) is served
straight from Redis without touching `IProductRepository` at all.

> **Request binding.** Benzene binds the JSON request **body** onto your request object; the TypeScript
> port does not bind path segments the way .NET does, so `products:get` reads `productId` from the body.
> The `@httpEndpoint('GET', '/products/{productId}')` route still matches the URL — the value is read from
> what the client sends in the body. See [AWS Lambda Setup](../getting-started-aws.md).

### 4. Write-through: keep the cache in sync on updates

`writeThroughAsync` runs your write, then updates the cache based on the result's `BenzeneResultStatus` —
`ok`/`created`/`updated`/`accepted` sets the cache to the new payload, `deleted` invalidates it, anything
else leaves the cache untouched:

```ts
// handlers.ts (continued)
@message('products:update', { requestType: UpdateProduct, responseType: Product })
export class UpdateProductHandler implements IMessageHandler<UpdateProduct, Product> {
  static readonly inject = [ProductCacheService, IProductRepository] as const;

  constructor(
    private readonly cache: ProductCacheService,
    private readonly products: IProductRepository,
  ) {}

  handleAsync(request: UpdateProduct): Promise<IBenzeneResultOf<Product>> {
    const entry = this.cache.getProductEntry(request.productId!);
    return entry.writeThroughAsync(() => this.products.updateAsync(request.productId!, request));
  }
}
```

Because `IProductRepository.updateAsync` returns `IBenzeneResultOf<Product>` directly, the single-argument
`writeThroughAsync(modifyDatabaseFunc)` overload is all you need — it reads the payload straight off the
result. If your write method's return type isn't `IBenzeneResultOf<T>`, use the
`writeThroughAsync(modifyDatabaseFunc, getCacheValue)` overload instead (see
[Advanced Usage in Caching](../caching.md#advanced-usage)).

### 5. Invalidation: clear the cache on delete

`writeThroughInvalidateAsync` runs your write and invalidates the cache only if the result `isSuccessful`
— there's no `Set` path, since a delete has nothing to cache:

```ts
// handlers.ts (continued)
import { VoidResult } from '@benzene/abstractions';

export class DeleteProductRequest {
  productId?: string;
}

@message('products:delete', { requestType: DeleteProductRequest, responseType: VoidResult })
export class DeleteProductHandler implements IMessageHandler<DeleteProductRequest, VoidResult> {
  static readonly inject = [ProductCacheService, IProductRepository] as const;

  constructor(
    private readonly cache: ProductCacheService,
    private readonly products: IProductRepository,
  ) {}

  handleAsync(request: DeleteProductRequest): Promise<IBenzeneResultOf<VoidResult>> {
    const entry = this.cache.getProductEntry(request.productId!);
    return entry.writeThroughInvalidateAsync(() => this.products.deleteAsync(request.productId!));
  }
}
```

You can also invalidate directly, outside of a write, by calling `entry.invalidateAsync()` — useful if
something other than this service changed the underlying record (e.g. a batch job, or another service
writing to the same database).

### 6. Add a Redis health check

`@benzene/cache-core`'s `addCacheHealthCheck` wraps `ICacheService.canConnectAsync()` (a Redis `PING` for
`RedisCacheService`) into a ready-made health check, so a monitoring system can confirm Redis connectivity
without hitting a real product handler. Wire it into a [health-check](../health-checks.md) topic:

```ts
import { useHealthCheck } from '@benzene/health-checks';
import { addCacheHealthCheck } from '@benzene/cache-core';

.configure((app) =>
  useApiGateway(app, (api) => {
    useHealthCheck(api, 'healthcheck', (checks) => addCacheHealthCheck(checks));
    useMessageHandlers(api, GetProductHandler, UpdateProductHandler, DeleteProductHandler);
  }),
)
```

`addCacheHealthCheck` resolves the registered `ICacheService` and reports `CanConnect` — healthy if
`canConnectAsync()` returns `true`, `failed` otherwise or if it throws. See
[Caching: Health Check](../caching.md#health-check) and [Health Checks](../health-checks.md).

## Testing

You can unit-test your cache-entry logic without any Redis at all by faking `IRedisConnectionFactory`. It
is a one-method seam (`connectAsync(options)` returning a `RedisClient` — the five commands the adapter
uses: `get`/`set`/`del`/`keys`/`ping`), so a plain object stands in for the whole client. This is the
fastest way to assert which key gets touched, and lazy-load vs. write-through branching:

```ts
// test/productCache.test.ts
import { describe, expect, it, vi } from 'vitest';
import type { RedisOptions } from 'ioredis';
import { NullLogger } from '@benzene/abstractions';
import { IRedisConnectionFactory, RedisClient } from '@benzene/cache-redis';
import { BenzeneResult } from '@benzene/results';
import { ProductCacheService } from '../src/ProductCacheService.js';
import { Product } from '../src/ProductRepository.js';

function fakeConnectionFactory(client: Partial<RedisClient>): IRedisConnectionFactory {
  return { connectAsync: (_options: RedisOptions) => Promise.resolve(client as RedisClient) };
}

describe('ProductCacheService', () => {
  it('writes the updated payload back through the cache', async () => {
    const set = vi.fn<RedisClient['set']>().mockResolvedValue('OK');
    const service = new ProductCacheService(
      new NullLogger(),
      fakeConnectionFactory({ set, get: () => Promise.resolve(null), ping: () => Promise.resolve('PONG') }),
    );
    const product: Product = { id: '42', name: 'Widget', priceInCents: 100 };

    const entry = service.getProductEntry('42');
    const result = await entry.writeThroughAsync(() => Promise.resolve(BenzeneResult.updated(product)));

    expect(result.isSuccessful).toBe(true);
    expect(set).toHaveBeenCalledWith('product:42', expect.any(String), 'EX', 600); // 10-minute TTL
  });
});
```

Prefer testing the *handlers* through their `IProductRepository` port with a mocked repository (no cache
or database needed) — see [Mocking External Dependencies](mocking-dependencies.md).

For a true integration test against a real Redis — confirming your `getConfigurationOptionsAsync()`
options actually connect, TTLs really expire, `KEYS`-based invalidation really matches — run Redis via
Docker Compose:

```yaml
# docker-compose.yaml
services:
  redis:
    image: redis
    ports:
      - '6379:6379'
```

Point a test at the real `RedisConnectionFactory` (`REDIS_URL=localhost:6379`) and exercise
`getProductEntry(...)`/`lazyLoadAsync`/`writeThroughAsync` the same way the handler does. Run
`docker compose up -d redis` before the test run and tear it down afterward.

## Troubleshooting

**`getValueAsync()`/reads always return `undefined`, even though I know the key exists.** Read errors are
caught and logged, not thrown, so a connectivity or serialization problem silently looks like a cache
miss. `CacheEntry<T>.getValueAsync` logs at `Error` level with `"Error occurred when trying to read from
cache"`; `RedisCacheEntry<T>` logs at `Warning` level with `"Error getting value from cache"`. Check your
logs — usually a bad `getConfigurationOptionsAsync()` host/port, or a Redis instance that isn't reachable
from where the code runs (e.g. a container that can't resolve `localhost`).

**Stale data after an update.** Confirm the write path actually goes through `writeThroughAsync` (or an
explicit `invalidateAsync()`/`setValueAsync()`). If something else writes to the same underlying store
without going through `ProductCacheService`, the cache has no way to know the value changed. Also
double-check the key: `getProductEntry` builds the key from `productId`, so a write and a read against two
different derived keys (a typo in the prefix) never see each other.

**`invalidateAsync()` returns `false` even though I expect the key to exist.** For a single-key
`ICacheEntry<T>`, `RedisCacheEntry<T>` returns whatever `DEL` reports — `false` if the key was already
gone. For prefix/wildcard invalidation, `RedisWildcardActions` only returns `true` if at least one key was
actually deleted, and swallows connection errors (logged as a warning) rather than throwing.

## Variations

### Multiple keys for one value

If the same product needs to be looked up by both its ID and an external SKU, use `createMultiKeyActions`
instead of `createCacheEntry` so a single `setValueAsync`/`invalidateAsync` call updates every key:

```ts
getProductMultiKeyActions(productId: string, sku: string): ICacheWriteActions<Product> {
  return this.createMultiKeyActions<Product>([`product:${productId}`, `product:sku:${sku}`]);
}
```

### Bulk invalidation

To invalidate every cached product at once (e.g. after a bulk import), use `createPrefixActions`:

```ts
getAllProductsInvalidation(): ICacheInvalidateActions {
  return this.createPrefixActions('product:');
}
```

This runs a Redis `KEYS product:*` scan — an O(N) operation over the whole keyspace — so avoid calling it
often against a large, busy production Redis instance. See [Caching: Advanced Usage](../caching.md#advanced-usage)
for the full details and a custom-cache-action-mapping example.

### Layer caching in front of a database

If your `IProductRepository` is backed by a relational database, this cache sits cleanly in front of it —
see [TypeORM Integration](typeorm-integration.md) for the repository/port side, and let hot reads skip the
database entirely.

## Further Reading

- [Caching](../caching.md) — the full reference for `@benzene/cache-core`/`@benzene/cache-redis`,
  including every member of `RedisCacheService`/`ICacheEntry<T>` and the write-through/invalidate semantics
  used above.
- [Health Checks](../health-checks.md) — wiring `addCacheHealthCheck` into a pipeline.
- [TypeORM Integration](typeorm-integration.md) — the database behind the repository port.
- [Mocking External Dependencies](mocking-dependencies.md) — testing handlers with a mocked repository.
- [Message Handlers](../message-handlers.md) — the `inject` convention and `IBenzeneResultOf<T>`.
- [Testing Benzene](../testing-benzene.md) — exercising the handlers above end to end.

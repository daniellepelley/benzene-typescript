# Caching

Benzene's caching support is a provider-agnostic abstraction (`@benzene/cache-core`) with a Redis
implementation (`@benzene/cache-redis`) that your handlers and services consume directly through
dependency injection.

## Overview

Caching in Benzene is **not** a middleware you add to a pipeline with a `useCache(...)` call — there is
no such function in the codebase. Instead, `@benzene/cache-core` gives you a small set of abstractions
for building a cache-backed service:

- `ICacheService` — a marker interface with a single `canConnectAsync()` method, used to health-check
  whatever cache backend you're using. It declares a merged `ServiceToken` so it can be resolved from
  the container.
- `ICacheEntry<T>` — represents a single cached value. Supports reading (`getValueAsync`),
  writing/invalidating (inherited from `ICacheWriteActions<T>`), and a "lazy load" pattern
  (`lazyLoadAsync`) that reads from cache first and falls back to a database/service call on a miss.
- `ICacheWriteActions<T>` — write and "write-through" operations (`setValueAsync`, `writeThroughAsync`).
- `ICacheInvalidateActions` — invalidate and "write-through invalidate" operations (`invalidateAsync`,
  `writeThroughInvalidateAsync`). `ICacheWriteActions<T>` extends this.
- `CacheUpdateAction` — an enum (`None`, `Set`, `Invalidate`) used to tell a generic `writeThroughAsync`
  call what to do with the cache after the underlying write completes.

`@benzene/cache-core` also ships abstract base classes (`CacheInvalidateActions`, `CacheWriteActions<T>`,
`CacheEntry<T>`) that implement the serialization, logging, and write-through/lazy-load orchestration
around these interfaces, so a concrete cache provider only needs to implement the few `protected
abstract` methods that actually talk to the backend (get/set/delete a raw string value).
`@benzene/cache-redis`'s `RedisCacheEntry<T>`, `RedisMultiKeyActions<T>`, and `RedisWildcardActions`
are exactly this: classes that fill in those abstract methods using `ioredis`.

Use this when you want request-scoped or cross-instance caching of message handler results or downstream
reads, with an opt-in write-through/invalidate pattern that keeps your handler code declarative (call
`lazyLoadAsync`/`writeThroughAsync` instead of hand-writing "check cache, then call database, then
update cache" each time).

> **Port note — Redis client.** The .NET `Benzene.Cache.Redis` wraps `StackExchange.Redis`, a
> .NET-only library. Per the port's [third-party-integration convention](../README.md#porting-conventions),
> it is re-created as an adapter over **[`ioredis`](https://github.com/redis/ioredis)**, the popular
> Node Redis client. The abstraction core (`@benzene/cache-core`) is a straight port; only the Redis
> layer is re-implemented against `ioredis`.

> **Port note — process timers.** In .NET every cache operation opens a named `IProcessTimerFactory`
> timing scope, which makes `IProcessTimerFactory` a hard constructor dependency of the Redis cache
> service. Benzene's process-timer surface is deferred in the TypeScript port, so those timing scopes
> are dropped and there is **no `IProcessTimerFactory` dependency** to satisfy — the read/write control
> flow is otherwise identical. See the README roadmap.

## Prerequisites

- A Benzene service using `@benzene/core-message-handlers` (message handlers returning
  `IBenzeneResultOf<T>`).
- Node 22+.
- For distributed caching: a reachable Redis instance (or cluster) and the `ioredis` connection options
  for it.

## Installation

Add the core abstractions:

```
npm install @benzene/cache-core
```

For Redis-backed caching, also add:

```
npm install @benzene/cache-redis
```

`@benzene/cache-redis` depends on `@benzene/cache-core` and `ioredis` directly — no other runtime
dependencies are pulled in.

## Basic Usage

Caching is consumed directly by application code — there's no pipeline middleware to add. You subclass
`RedisCacheService`, supply Redis connection options, and expose typed cache-entry accessors for the
keys you care about:

```ts
import type { RedisOptions } from 'ioredis';
import { ILogger } from '@benzene/abstractions';
import { ICacheEntry } from '@benzene/cache-core';
import { RedisCacheService, IRedisConnectionFactory } from '@benzene/cache-redis';

export class OrderCacheService extends RedisCacheService {
  static readonly inject = [ILogger, IRedisConnectionFactory] as const;

  constructor(logger: ILogger, connectionFactory: IRedisConnectionFactory) {
    super(logger, connectionFactory);
    this.startConnection(); // kick off the (lazy) Redis connection eagerly
  }

  protected getConfigurationOptionsAsync(): Promise<RedisOptions> {
    return Promise.resolve({ host: 'localhost', port: 6379 });
  }

  getOrderEntry(orderId: string): ICacheEntry<Order> {
    return this.createCacheEntry<Order>(`order:${orderId}`);
  }
}
```

`RedisCacheService` takes an `ILogger` and an `IRedisConnectionFactory`; the `static readonly inject`
array declares those as the constructor's dependencies so the container can resolve it (see
[Message Handlers](message-handlers.md) for the `inject` convention). `getConfigurationOptionsAsync`
returns an `ioredis` `RedisOptions`; `ioredis` connects when the client is constructed, so there's no
separate async connect call.

Register it in DI — the default `IRedisConnectionFactory` (`RedisConnectionFactory`, which opens a real
`ioredis` connection) and your cache service — and inject it wherever you need it:

```ts
import { RedisConnectionFactory, IRedisConnectionFactory } from '@benzene/cache-redis';

addBenzene(services);
services.addScoped(IRedisConnectionFactory, RedisConnectionFactory);
services.addScoped(OrderCacheService);
```

```ts
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';

@message('orders:get', { requestType: GetOrderRequest, responseType: Order })
export class GetOrderMessageHandler implements IMessageHandler<GetOrderRequest, Order> {
  static readonly inject = [OrderCacheService, IOrderRepository] as const;

  constructor(
    private readonly cache: OrderCacheService,
    private readonly orders: IOrderRepository,
  ) {}

  handleAsync(request: GetOrderRequest): Promise<IBenzeneResultOf<Order>> {
    const entry = this.cache.getOrderEntry(request.orderId);

    return entry.lazyLoadAsync(() => this.orders.getOrderAsync(request.orderId));
  }
}
```

`lazyLoadAsync` checks the cache first; on a miss it calls your `databaseReadFunc`, and if that result
`isSuccessful`, stores the payload back in the cache before returning it.

## Configuration

### `RedisCacheService`

| Member | Purpose |
| --- | --- |
| `getConfigurationOptionsAsync()` (abstract) | Supplies the `ioredis` `RedisOptions` used to connect. Called once, lazily, the first time the connection is needed (or immediately if `startConnection()` is called in your constructor). |
| `defaultCacheLifespan` (getter, default `300_000` ms — 5 minutes) | TTL applied to `setValueAsync` calls that don't pass an explicit `expireIn`. Override the getter to change the default. |
| `startConnection()` (protected) | Touches the lazily-created connection promise so the connection begins immediately rather than on first use. Optional — call it from your subclass's constructor if you want to fail fast / warm the connection. |
| `createCacheEntry<T>(key)` (protected) | Returns an `ICacheEntry<T>` (backed by `RedisCacheEntry<T>`) for a single Redis string key. |
| `createMultiKeyActions<T>(keys)` (protected) | Returns an `ICacheWriteActions<T>` that sets/invalidates the *same* value across multiple keys at once. |
| `createPrefixActions(prefix)` (protected) | Returns an `ICacheInvalidateActions` that invalidates every key matching `prefix + "*"`. |
| `createWildcardActions(pattern)` (protected) | Returns an `ICacheInvalidateActions` that invalidates every key matching an arbitrary glob pattern. |

> **Durations are milliseconds.** The .NET `TimeSpan?` parameters and the `DefaultCacheLifespan`
> `TimeSpan` become plain `number` values in **milliseconds** — the port's standard duration unit. The
> Redis layer converts the effective lifespan to whole seconds for `SET ... EX` (so `300_000` ms →
> `EX 300`, and an explicit `expireIn` of `30_000` → `EX 30`).

### `ICacheEntry<T>` / write-through actions

| Member | Purpose |
| --- | --- |
| `getValueAsync()` | Reads and deserializes the cached value, or `undefined` on a miss or error (errors are logged, not thrown). |
| `setValueAsync(value, expireIn?)` | Serializes (via `@benzene/core-message-handlers`'s `JsonSerializer`) and stores the value, using `expireIn` (ms) or the service's `defaultCacheLifespan`. |
| `invalidateAsync()` | Deletes the key(s). |
| `lazyLoadAsync(databaseReadFunc)` | Cache-aside read: hit returns from cache; miss calls `databaseReadFunc` and caches a successful result. |
| `writeThroughAsync(modifyDatabaseFunc)` | Runs the write, then updates the cache based on the result's `BenzeneResultStatus` (`ok`/`created`/`updated`/`accepted` → `Set`; `deleted` → `Invalidate`; anything else → no cache change). |
| `writeThroughAsync(..., getCacheValue)` / `writeThroughAsync(..., getCacheValue, getCacheAction)` | Overloads for when the write's result type isn't `IBenzeneResultOf<T>` directly, or when you need custom cache-action logic instead of the default status mapping. |
| `writeThroughInvalidateAsync(modifyDatabaseFunc)` | Runs the write, and invalidates the cache only if the result `isSuccessful` — no `Set` path, since there's nothing to cache (e.g. a delete-only operation). |

The `lazyLoadAsync` overload takes an optional second `createResult` argument (`(value: T) => TResult`)
for when your database read returns a more specific `IBenzeneResultOf<T>` subtype; omit it and a cache
hit is wrapped with `BenzeneResult.ok(value)`.

### Health check

`@benzene/cache-core` exposes `ICacheService.canConnectAsync()` (for `RedisCacheService`, a Redis
`PING`) as the primitive a health check builds on, and ships the ready-made `CacheHealthCheck` and
`addCacheHealthCheck` helpers that wrap it:

```ts
import { addCacheHealthCheck } from '@benzene/cache-core';

useHealthCheck(app, 'healthcheck', (checks) => addCacheHealthCheck(checks));
```

`addCacheHealthCheck` registers a check (`type: 'Cache'`) that resolves the registered `ICacheService`
and reports `CanConnect` — healthy if `canConnectAsync()` returns `true`, `failed` otherwise or if it
throws (with the failure's type name under `data.Error`, never its message). The C# generic
`CacheHealthCheck<TCacheService>` / `addCacheHealthCheck<TCacheService>()` collapse to the single
`ICacheService` token the port registers cache services under; the dependency label defaults to the
concrete service's class name.

## Advanced Usage

### Multi-key writes

If the same value needs to live under more than one key (e.g. a primary key and a secondary lookup key),
use `createMultiKeyActions`:

```ts
getOrderMultiKeyActions(orderId: string, externalRef: string): ICacheWriteActions<Order> {
  return this.createMultiKeyActions<Order>([`order:${orderId}`, `order:ref:${externalRef}`]);
}
```

`setValueAsync`/`invalidateAsync` on the result apply to every key in the set; the operation reports
success if *any* key was updated/deleted.

### Prefix and wildcard invalidation

```ts
getAllOrdersInvalidation(): ICacheInvalidateActions {
  return this.createPrefixActions('order:');
}
```

Internally this runs a Redis `KEYS <pattern>` command and deletes the matches in batches (capped at
1,048,000 keys per batch). `KEYS` is an O(N) scan of the whole keyspace on the Redis side — be cautious
about using prefix/wildcard invalidation against a large, busy production Redis instance, since it can
block other commands while it runs. (This is a faithful port of the .NET behaviour, not a
recommendation.)

### Custom cache-action mapping

The three-argument `writeThroughAsync` overload lets you decide, per result, whether to `Set`,
`Invalidate`, or leave the cache alone — useful when the default `BenzeneResultStatus` →
`CacheUpdateAction` mapping (`ok`/`created`/`updated`/`accepted` → `Set`, `deleted` → `Invalidate`)
doesn't fit your handler:

```ts
import { CacheUpdateAction } from '@benzene/cache-core';
import { BenzeneResultStatus } from '@benzene/results';

await entry.writeThroughAsync(
  () => this.orders.archiveOrderAsync(orderId),
  (result) => result.payload,
  (result) =>
    result.status === BenzeneResultStatus.ok ? CacheUpdateAction.Invalidate : CacheUpdateAction.None,
);
```

### A different cache backend

Because `@benzene/cache-core`'s `CacheEntry<T>`/`CacheWriteActions<T>`/`CacheInvalidateActions` do all
the serialization, logging, and write-through/lazy-load orchestration, adding support for a backend
other than Redis means implementing just the raw storage primitives:

```ts
protected abstract getEntryValueAsync(): Promise<string | undefined>;
protected abstract setEntryValueAsync(value: string, expireIn: number | undefined): Promise<boolean>;
protected abstract invalidateEntryAsync(): Promise<boolean>;
```

along with the `logger` and `keyDescription` getters (used for log messages). `@benzene/cache-redis`'s
`RedisCacheEntry<T>` is a complete, minimal example of this.

## Examples

See [Basic Usage](#basic-usage) for a full worked example (custom `RedisCacheService` subclass +
message handler using `lazyLoadAsync`), and [Advanced Usage](#advanced-usage) for multi-key and
wildcard invalidation.

## Troubleshooting

**`getValueAsync()` always returns `undefined`, even though I know the key exists.**
Read errors are caught and logged rather than thrown, so a connectivity or serialization problem will
silently look like a cache miss. `CacheEntry<T>.getValueAsync` logs at `Error` level with the message
`"Error occurred when trying to read from cache"`; `RedisCacheEntry<T>.getEntryValueAsync` logs at
`Warning` level with `"Error getting value from cache"`. Check your logs for those messages.

**`invalidateAsync()` on a prefix/wildcard entry returns `false` even though I expect keys to exist.**
`RedisWildcardActions` returns `true` only if at least one key was actually deleted, and swallows
connection errors (logged as a warning) by returning `false` rather than throwing. Check for `"Error
deleting keys from cache"` in your logs.

## See Also

- [Message Handlers](message-handlers.md) — the `inject` convention and how handlers are dispatched.
- [Message Results](message-result.md) — for `IBenzeneResultOf<T>` / `BenzeneResultStatus`.
- [Common Middleware](common-middleware.md) — the transport-agnostic middleware Benzene ships.
- [Cookbooks](cookbooks/README.md) — practical, end-to-end recipes.

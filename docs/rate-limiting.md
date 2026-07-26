# Rate Limiting

`@benzene/rate-limiting` adds best-effort request rate limiting to any Benzene pipeline. Its job is
**protection**: endpoints a service can't avoid exposing publicly — health checks, a message endpoint
open to the internet — should not be a free denial-of-service vector, or, on serverless plans that
scale on demand, a way for a stranger to run up your bill.

## Overview

The limiter is a piece of [middleware](middleware.md) you place **before** whatever it protects. A
message over the limit never reaches the protected stage: it short-circuits with a `too-many-requests`
[result](message-result.md), which the standard status mapping serves as **HTTP 429**. Nothing is ever
queued — a protective limiter that queues requests just moves the resource exhaustion into memory — so
rejection is immediate.

> **Port note.** The .NET package builds on `System.Threading.RateLimiting`, part of the BCL. Node has
> no equivalent, so the port re-creates the small subset it needs (`RateLimiter`, `RateLimitLease`,
> `FixedWindowRateLimiter`, `TokenBucketRateLimiter`, `ConcurrencyLimiter`) inside the package — no
> runtime dependency is added. The `SlidingWindowRateLimiter` used in one .NET example is **not
> ported**; bring your own limiter (below) covers that case.

### Read this first: it limits per instance, in memory

The limiter lives inside one service instance, and its state is held **in process memory only** — there
is no distributed/shared store, and none is pluggable. Run three instances behind a load balancer and
you admit up to **3× the configured rate**; let a serverless platform scale out under load and the
multiplier grows with it — the very scale-out an attacker triggers weakens the brake. That makes this
deliberately *not* an exact science:

- **Authoritative rate limiting belongs at the gateway** — API Gateway usage plans, Azure API
  Management policies, your ingress/WAF — where one limit covers every instance.
- Use this package as **defense-in-depth**: a cheap floor of protection for endpoints that would
  otherwise ship with none, and for deployments that don't have a gateway in front of them yet.

There is also **no per-key / per-caller partitioning**. A single limiter instance is shared across
every message on the pipeline for the process lifetime, so all traffic through that pipeline is counted
against one shared budget — the limiter does not bucket by IP, tenant, or any request field. (The .NET
`PartitionedRateLimiter` seam is not ported.)

## Installation

Requires Node 22+.

```bash
npm install @benzene/rate-limiting
```

## Basic usage

Add the middleware **before** the stage it should protect. Each `use*RateLimiting` call is a free
function taking the pipeline builder first (the port's convention for C# extension methods — see
[Common Middleware](common-middleware.md)), so you call it inside your transport's builder callback:

```ts
import { useApiGateway } from '@benzene/aws-lambda-api-gateway';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { useHealthCheck } from '@benzene/health-checks';
import { useFixedWindowRateLimiting } from '@benzene/rate-limiting';

useApiGateway(app, (api) => {
  useFixedWindowRateLimiting(api, 60, 60_000); // 60 requests / minute
  useHealthCheck(api, 'healthcheck', (checks) => checks.addHealthCheck(DatabaseHealthCheck));
  useMessageHandlers(api, CreateOrderHandler);
});
```

C#'s `TimeSpan` window/period arguments become millisecond `number`s (`TimeSpan.FromMinutes(1)` →
`60_000`), per the port's `TimeSpan → ms` convention.

A message over the limit short-circuits with `BenzeneResult.tooManyRequests(...)`, which
[`DefaultHttpStatusCodeMapper`](message-result.md#transport-mapping) serves as **HTTP 429**. The error
message carries the limiter's retry-after hint when one is available, rendered into the RFC 7807-style
error body:

```json
{ "status": "too-many-requests", "detail": "Rate limit exceeded; retry after 42s" }
```

## Strategies

Three builder-first free functions cover the common strategies. Each is sugar over
[`useRateLimiting`](#bring-your-own-limiter) with a specific limiter and cost.

### Fixed window — `useFixedWindowRateLimiting`

Admits at most `permitLimit` messages per fixed `windowMs`; excess is rejected immediately. The simple
guard for utility endpoints like health checks, where every hit costs roughly the same.

```ts
export function useFixedWindowRateLimiting<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  permitLimit: number,
  windowMs: number,
): IMiddlewarePipelineBuilder<TContext>;
```

```ts
import { useFixedWindowRateLimiting } from '@benzene/rate-limiting';

useFixedWindowRateLimiting(app, 100, 60_000); // 100 messages per minute
```

Backed by `FixedWindowRateLimiter` (one token per message, `queueLimit: 0`). The window is rolled
forward lazily from the clock rather than by a background timer — equivalent for the attempt-only,
no-queue path this package uses.

### Token bucket — `useTokenBucketRateLimiting`

A steady sustained rate that tolerates short bursts. The bucket holds up to `tokenLimit` tokens and is
refilled by `tokensPerPeriod` every `replenishmentPeriodMs`; each message costs one token.

```ts
export function useTokenBucketRateLimiting<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  tokenLimit: number,
  tokensPerPeriod: number,
  replenishmentPeriodMs: number,
): IMiddlewarePipelineBuilder<TContext>;
```

```ts
import { useTokenBucketRateLimiting } from '@benzene/rate-limiting';

// Burst up to 100, sustained 10 messages/second:
useTokenBucketRateLimiting(app, 100, 10, 1_000);
```

Backed by `TokenBucketRateLimiter`, replenished lazily from the clock (`queueLimit: 0`).

### Payload size — `usePayloadSizeRateLimiting`

Request *count* isn't always the right unit: a message-accepting endpoint can be abused with a few
enormous payloads as effectively as with many small ones. This runs a token bucket where **each message
costs its request body's size in UTF-8 bytes** (a bodyless message costs 1) — a bytes-per-second budget.

```ts
export function usePayloadSizeRateLimiting<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  maxBurstBytes: number,
  bytesPerPeriod: number,
  replenishmentPeriodMs: number,
): IMiddlewarePipelineBuilder<TContext>;
```

```ts
import { usePayloadSizeRateLimiting } from '@benzene/rate-limiting';

usePayloadSizeRateLimiting(
  app,
  256 * 1024, // maxBurstBytes: the most admissible at once
  64 * 1024,  // bytesPerPeriod: sustained 64 KiB/second
  1_000,      // replenishmentPeriodMs
);
```

The per-message cost is read from the registered `IMessageBodyGetter` (`Buffer.byteLength(body,
'utf8')`). A single payload larger than `maxBurstBytes` can never be granted, so it is always rejected —
the limiter's underlying `attemptAcquire` throws a `RangeError` for a cost above its maximum, which the
middleware treats as a rejection (429), not an internal error.

## Bring your own limiter

Every built-in above is sugar over the same seam: any `RateLimiter` plugs into `useRateLimiting`, with
an optional per-message permit cost.

```ts
export type PermitCost<TContext> = (resolver: IServiceResolver, context: TContext) => number;

export function useRateLimiting<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  rateLimiter: RateLimiter,
  permitCost?: PermitCost<TContext>, // default: () => 1
): IMiddlewarePipelineBuilder<TContext>;
```

The package exports `FixedWindowRateLimiter`, `TokenBucketRateLimiter`, and `ConcurrencyLimiter`
directly, and `RateLimiter` is an abstract class you can subclass (its one method is
`attemptAcquire(permitCount?): RateLimitLease`):

```ts
import { ConcurrencyLimiter, useRateLimiting } from '@benzene/rate-limiting';

// Cap in-flight messages instead of rate — at most 10 processed concurrently:
useRateLimiting(app, new ConcurrencyLimiter({ permitLimit: 10, queueLimit: 0 }));

// Or a custom cost per message:
useRateLimiting(app, myLimiter, (resolver, context) => costOf(context));
```

The limiter instance is shared across every message on the pipeline for the process lifetime — the
caller owns it. Concurrency-style limiters work correctly: the acquired `RateLimitLease` is held across
the rest of the pipeline (`next()`) and released — returning its permits — when the message completes,
in a `finally`.

## How a limited request short-circuits

`RateLimitingMiddleware` computes the message's cost, then calls `rateLimiter.attemptAcquire(cost)`
without queuing:

1. If the lease **is acquired**, it calls `next()` and holds the lease until the message finishes.
2. If the lease is **not acquired** (or the cost exceeds what the limiter could ever grant), it does
   **not** call `next()` — the protected middleware never runs. Instead it sets a
   `BenzeneResult.tooManyRequests(...)` result on the context via the registered
   `IMessageHandlerResultSetter`.

Over HTTP that result maps to **429** (see [Message Results — transport
mapping](message-result.md#transport-mapping)); on async/event transports it settles the message as a
failure. The retry-after hint, when the limiter provides one, is rounded to whole seconds and appended
to the error message (`"Rate limit exceeded; retry after 42s"`).

## Strategy reference

| Function | Limiter | Unit |
|---|---|---|
| `useFixedWindowRateLimiting(app, permitLimit, windowMs)` | `FixedWindowRateLimiter` | messages per window |
| `useTokenBucketRateLimiting(app, tokenLimit, tokensPerPeriod, replenishmentPeriodMs)` | `TokenBucketRateLimiter` | messages, smoothed with bursts |
| `usePayloadSizeRateLimiting(app, maxBurstBytes, bytesPerPeriod, replenishmentPeriodMs)` | `TokenBucketRateLimiter` | payload bytes |
| `useRateLimiting(app, rateLimiter)` | bring your own | 1 permit per message |
| `useRateLimiting(app, rateLimiter, permitCost)` | bring your own | bring your own |

## See also

- [Middleware](middleware.md) — the pipeline mechanism this middleware plugs into.
- [Common Middleware](common-middleware.md) — the other ready-made pipeline middleware, and why C#
  extension methods become free functions here.
- [Message Results](message-result.md) — the `too-many-requests` result and its HTTP 429 mapping.
- [Message Handlers](message-handlers.md) — the stage rate limiting most often protects.
- [Porting conventions](../README.md#porting-conventions) — the `TimeSpan → ms` and free-function rules
  applied above.

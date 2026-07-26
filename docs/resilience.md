# Resilience

Retry the rest of a Benzene pipeline on failure, with exponential backoff.

> **Boundary:** `@benzene/resilience` ships **retry-with-backoff only**, with zero runtime
> dependencies. Circuit breaker, timeout, bulkhead, hedging, and fallback are **not** ported — the
> .NET original's broader toolkit lives in a separate `Benzene.Resilience.Polly` package (built on
> [Polly](https://www.pollydocs.org/)) that has no TypeScript equivalent today. See
> [Beyond retry](#beyond-retry) for what to reach for instead.

## Overview

`@benzene/resilience` implements exactly one resilience pattern: **retry with exponential backoff**,
as a normal Benzene middleware (`RetryMiddleware<TContext>`) added to a pipeline via the
`useRetry(...)` free function. It's a small, hand-rolled loop over `next()` — no external library.

Because it's an ordinary `IMiddleware<TContext>`, `useRetry` slots into a pipeline like any other
`use*` call and wraps everything *after* it in the chain — message handlers, validation, or nested
middleware — re-running that entire sub-pipeline on each attempt.

`RetryMiddleware<TContext>` retries on two independent conditions:

- **An error was thrown** by `next()` — checked with a `shouldRetry` predicate (default: retry
  every error except a cancellation, `OperationCanceledException`).
- **`next()` completed without throwing, but the context still represents a failure** — checked with
  a `shouldRetryContext` predicate you supply (default: never retry a completed result). This is
  useful because many Benzene pipelines represent failure as a result set on the context object
  rather than as a thrown error.

## Prerequisites

- Node 22+.
- A Benzene middleware pipeline (any transport — AWS Lambda, Azure Functions, Express) built with
  `IMiddlewarePipelineBuilder<TContext>`. See [Middleware](middleware.md).

## Installation

```
npm install @benzene/resilience
```

The package depends only on `@benzene/abstractions-middleware` — no third-party runtime dependencies.

## Basic Usage

Add `useRetry(app)` at the point in the pipeline you want retried. Everything nested after it is
re-run on each retry:

```ts
import { useRetry } from '@benzene/resilience';
import { useMessageHandlers } from '@benzene/core-message-handlers';

useRetry(app, { numberOfRetries: 3 });
useMessageHandlers(app, ProcessOrderHandler);
```

With the defaults (`numberOfRetries: 3`, `initialDelayMs: 200`, `backoffFactor: 2.0`), a handler that
keeps throwing is attempted up to **4 times total** (the original attempt plus 3 retries), waiting
200ms, then 400ms, then 800ms between attempts.

## Configuration

`useRetry<TContext>(app, options?)` forwards a single trailing `RetryOptions<TContext>` object to the
`RetryMiddleware<TContext>` constructor. C#'s positional constructor parameters collapse into this
options object, and `TimeSpan` maps to a millisecond `number`:

```ts
export interface RetryOptions<TContext> {
  numberOfRetries?: number;                             // default 3
  initialDelayMs?: number;                              // default 200
  backoffFactor?: number;                               // default 2.0
  shouldRetry?: (error: unknown) => boolean;            // default: retry all except OperationCanceledException
  shouldRetryContext?: (context: TContext) => boolean;  // default: () => false (never)
  delay?: DelayFunc;                                    // default: a setTimeout-backed delay
}
```

| Option | Default | Purpose |
| --- | --- | --- |
| `numberOfRetries` | `3` | Number of *additional* attempts after the first. Total possible invocations of `next()` is `numberOfRetries + 1`. |
| `initialDelayMs` | `200` | Delay in milliseconds before the *first* retry. |
| `backoffFactor` | `2.0` | Multiplier applied to the delay after each retry (exponential backoff). `1.0` gives a constant delay. |
| `shouldRetry` | retry everything except `OperationCanceledException` | `(error: unknown) => boolean` — called when `next()` throws, while attempts remain. Return `false` to let a specific error propagate immediately without retrying. |
| `shouldRetryContext` | `() => false` (never) | `(context: TContext) => boolean` — called after `next()` **completes without throwing**, while attempts remain. Return `true` to retry anyway based on state in `TContext` (e.g. a result object indicating a soft failure). |
| `delay` | `setTimeout`-backed wait | `DelayFunc` = `(delayMs: number) => Promise<void>` — the actual wait between attempts. Overriding it (e.g. to a no-op) is how the package's own tests run retry scenarios instantly. |

Retry accounting is shared across both failure modes: once `numberOfRetries` attempts have been used
up — whether from thrown errors, an unsatisfied `shouldRetryContext`, or a mix — the middleware
stops. An exhausted exception-based retry **rethrows the last error**; an exhausted context-based
retry simply returns (there was no error to throw).

> **Port note — no `maxDelay` / jitter.** The .NET `RetryMiddleware` also accepts `maxDelay` and a
> `jitter` transform (with a ready-made `FullJitter()` for thundering-herd protection). Those knobs
> are **not** in the TypeScript port today — `RetryOptions` exposes only the fields above. If you
> need capped, jittered backoff, layer it into your own `delay` function, or reach for a dedicated
> library (see [Beyond retry](#beyond-retry)).

## Advanced Usage

### Retrying based on context state instead of (or in addition to) errors

If your pipeline represents failure via a result on the context rather than by throwing, supply
`shouldRetryContext`:

```ts
import { useRetry } from '@benzene/resilience';
import { BenzeneResultStatus } from '@benzene/results';

useRetry<MyMessageContext>(app, {
  numberOfRetries: 3,
  shouldRetryContext: (context) => context.result?.status === BenzeneResultStatus.serviceUnavailable,
});
```

This re-runs the wrapped pipeline whenever the handler returns a `service-unavailable`-style result
without throwing, in addition to the default error-based retry behavior. See
[Message Results](message-result.md) for the status set.

### Narrowing which errors are retried

```ts
useRetry<MyMessageContext>(app, {
  numberOfRetries: 3,
  shouldRetry: (error) => error instanceof TypeError || error instanceof RangeError,
});
```

Anything not matched by `shouldRetry` propagates immediately on the first occurrence, bypassing
further retries.

### Not retrying cancellation

The default `shouldRetry` deliberately excludes `OperationCanceledException` (exported from
`@benzene/resilience`) — a cancelled operation is treated as intentional, not transient, mirroring
the .NET default `ex is not OperationCanceledException`:

```ts
import { OperationCanceledException } from '@benzene/resilience';

// thrown from your own code to signal an intentional cancellation the retry loop should honor
throw new OperationCanceledException();
```

### Tuning backoff

```ts
useRetry<MyMessageContext>(app, {
  numberOfRetries: 5,
  initialDelayMs: 50,
  backoffFactor: 3.0,
});
```

Delays for this configuration would be 50ms, 150ms, 450ms, 1350ms, 4050ms across the five retries.

### Testing pipelines that use retry

Pass a no-op `delay` to avoid real waits in tests — this is exactly how the package's own vitest
suite exercises retry timing instantly:

```ts
import { RetryMiddleware } from '@benzene/resilience';

const middleware = new RetryMiddleware<object>({ numberOfRetries: 3, delay: () => Promise.resolve() });
```

## Retrying outbound client calls

Retrying an *outbound* call — e.g. a `@benzene/clients` message client that returns
`service-unavailable` — is a **separate** decorator in the TypeScript port, not the same middleware.

> **Port note.** In .NET, `UseRetry(...)` works on the outbound `OutboundContext` unmodified. The
> TypeScript port instead ships a dedicated client decorator, `RetryBenzeneMessageClient`
> (`@benzene/clients`), which wraps an `IBenzeneMessageClient`. Use `useRetry` for inbound
> pipelines and `RetryBenzeneMessageClient` for outbound calls.

```ts
import { RetryBenzeneMessageClient } from '@benzene/clients';
import { BenzeneResultStatus } from '@benzene/results';

// default: retries service-unavailable / too-many-requests, up to 3 attempts, NOT timeout
const client = new RetryBenzeneMessageClient(innerClient);

// opt into retrying any transient status, with a custom retry count:
const aggressive = new RetryBenzeneMessageClient(innerClient, 5, (result) =>
  BenzeneResultStatus.isTransient(result.status),
);
```

`Timeout` is deliberately not retried by default (a timed-out operation may already have been
applied); opt in through the `shouldRetry` predicate as shown. When retries are exhausted the
decorator returns the *last* result, preserving its true status and any errors it carried.

## Troubleshooting

**A retried operation runs more times than `numberOfRetries` suggests.**
`numberOfRetries` is the number of *retries*, not the total attempt count — total attempts are
`numberOfRetries + 1`.

**A cancellation isn't being retried.**
That's the default `shouldRetry` behavior — `OperationCanceledException` is excluded on purpose. Pass
a custom `shouldRetry` predicate if you genuinely need to retry past a cancellation.

**Retries keep happening even though my handler "succeeded."**
Check your `shouldRetryContext` predicate. If the context always satisfies it (a bug in the
predicate, or a result field that's never populated the way you expect), the middleware keeps
retrying successful, non-throwing calls until `numberOfRetries` is exhausted, then returns normally
without an error — so the failure may not show up in a stack trace.

**I need a circuit breaker / timeout / bulkhead, not just retry.**
Not ported — see below.

## Beyond retry

The .NET original offers the full [Polly](https://www.pollydocs.org/) strategy set (circuit breaker,
timeout, hedging, fallback, rate limiting) through a sibling `Benzene.Resilience.Polly` package.
**There is no `@benzene/*` equivalent in the TypeScript port today** — `@benzene/resilience` is
retry-only, and this doc will not invent an API that doesn't exist.

For those patterns in a Node/TypeScript service, reach for an established resilience library and call
it from inside your own middleware (`app.useFn(...)` — see [Middleware](middleware.md)) or around your
port/client calls:

- [**cockatiel**](https://www.npmjs.com/package/cockatiel) — the closest analog to Polly: composable
  retry, circuit breaker, timeout, bulkhead, and fallback policies.
- [**p-retry**](https://www.npmjs.com/package/p-retry) — a focused retry helper (built on
  `retry`/`p-timeout`) when you only need retry/timeout around a promise.

These are third-party runtime dependencies of *your* service, not of Benzene — Benzene stays
dependency-free here on purpose.

## See Also

- [Middleware](middleware.md) — the pipeline mechanism `useRetry` plugs into.
- [Common Middleware](common-middleware.md) — the catalog of ready-made pipeline middleware, including
  a shorter `useRetry` entry.
- [Message Results](message-result.md) — the result/status type `shouldRetryContext` inspects.
- [Cookbooks](cookbooks/README.md) — practical recipes, including handling transient transport failures.

# Idempotency (de-duplicating redelivered messages)

Make a message handler run **at most once** per message, so a redelivery on an at-least-once
transport doesn't repeat the side effect (charge a card twice, send two emails, insert a row twice).

> **Boundary:** `@benzene/idempotency` ships an **in-memory, single-process** store
> (`InMemoryIdempotencyStore`). It is the only store in the box. Cross-instance de-duplication is
> deliberately not solved for you: to dedupe across instances you implement the three-method
> `IIdempotencyStore` interface against a shared backend (Redis, DynamoDB, a database) — the pattern is
> in [Step 5](#step-5--a-shared-store-for-multi-instance-deployments).

## Problem statement

At-least-once transports — SQS, SNS, Azure Service Bus, Event Hubs, Kafka — will occasionally deliver
the same message more than once: a visibility timeout lapses mid-processing, a consumer restarts before
committing, a producer retries after a network blip. If your handler has a side effect, processing the
duplicate does that side effect twice.

You want the second delivery to be recognised as a duplicate and short-circuited — without re-running
the handler — while a genuine *first* delivery of a different message still runs normally, and a
*failed* attempt is still retried on redelivery.

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and a Benzene worker/consumer. The examples below use an Azure
  Functions Service Bus trigger — see [Azure Functions](../azure-functions.md) — but the middleware is a
  plain `IMiddleware<TContext>` and works in any pipeline (SQS, Event Hub, HTTP, ...).
- The transport registered (e.g. `useServiceBus`), which supplies the message header/body/topic getters
  the default key strategy reads.

## Installation

```bash
npm install @benzene/idempotency @benzene/core-message-handlers @benzene/results \
  @benzene/abstractions @benzene/abstractions-message-handlers @benzene/abstractions-messages \
  @benzene/abstractions-middleware
```

## Step 1 — register a store

The middleware needs an `IIdempotencyStore`. For a single worker instance (or tests) use the shipped
in-memory store via `addInMemoryIdempotencyStore`. The TTL is a **millisecond** number (the C#
`TimeSpan` maps to a `number` throughout the port) and defaults to 24 hours:

```ts
import { addInMemoryIdempotencyStore } from '@benzene/idempotency';

addInMemoryIdempotencyStore(services, 24 * 60 * 60 * 1000); // retain keys for 24h
```

> **Multi-instance deployments need a shared store.** The in-memory store keeps its map in one process,
> so a duplicate redelivered to a *different* instance won't be recognised. Register a shared store
> instead (see [Step 5](#step-5--a-shared-store-for-multi-instance-deployments)).

## Step 2 — add the middleware

Add `useIdempotency` to the pipeline **before** `useMessageHandlers`, so it de-duplicates ahead of the
handler. Both are free functions taking the pipeline builder first (the port's shape for fluent
extensions). Reusing the `azureApp` helper from the [Azure Functions guide](../azure-functions.md):

```ts
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { useServiceBus, ServiceBusContext } from '@benzene/azure-function-service-bus';
import { useIdempotency } from '@benzene/idempotency';
import { azureApp } from './azureApp.js';
import { CapturePaymentHandler } from './CapturePaymentHandler.js';

const serviceBusApp = azureApp((app) =>
  useServiceBus(app, (sb) => {
    useIdempotency<ServiceBusContext>(sb); // <-- de-duplicate here
    useMessageHandlers(sb, CapturePaymentHandler);
  }),
);
```

The `azureApp` helper is where the store is registered, alongside `addBenzene`:

```ts
import { addBenzene } from '@benzene/core-message-handlers';
import {
  IAzureFunctionApp,
  IAzureFunctionAppBuilder,
  InlineAzureFunctionStartUp,
} from '@benzene/azure-function-core';
import { addInMemoryIdempotencyStore } from '@benzene/idempotency';

export function azureApp(configure: (app: IAzureFunctionAppBuilder) => void): IAzureFunctionApp {
  return new InlineAzureFunctionStartUp()
    .configureServices((services) => {
      addBenzene(services);
      addInMemoryIdempotencyStore(services); // defaults to a 24h TTL
    })
    .configure(configure)
    .build();
}
```

That's it. The first delivery of each message is processed; redeliveries of the same key short-circuit
without re-running the handler. Place `useIdempotency` after any logging/tracing middleware so
duplicates stay observable, but before the handler.

## Step 3 — how the key is derived

By default the middleware uses `HeaderOrBodyHashIdempotencyKeyStrategy`, which derives the key like this:

1. If the message carries an `idempotency-key` header (case-insensitive lookup, so `Idempotency-Key`
   also matches), its trimmed value is the key. This is the strongest option — the *producer* stamps a
   stable key (e.g. the business event ID), so even a re-published message with a byte-different body is
   still recognised as the same logical event.
2. Otherwise, the key is a deterministic SHA-256 hash of the message topic (id + version) and body, with
   each field length-prefixed so distinct triples can't collide through separator ambiguity. Identical
   redeliveries hash to the same key; genuinely different messages don't collide.

Tune it via the optional `configure` callback, which receives an `IdempotencyOptions`:

```ts
useIdempotency<ServiceBusContext>(sb, (options) => {
  options.headerName = 'idempotency-key'; // header to read a caller-supplied key from
  options.hashBodyWhenNoHeader = true;    // false = only de-dupe messages that carry an explicit key
  options.keyPrefix = 'orders:';          // namespace keys when several services share one store
});
```

Defaults: `headerName` is `'idempotency-key'`, `hashBodyWhenNoHeader` is `true`, `keyPrefix` is `''`,
and `inProgressBehavior` is `InProgressBehavior.Skip` (see [Step 4](#step-4--failure-handling-retries-still-work)).

To key on a business identifier instead, register your own `IIdempotencyKeyStrategy<TContext>` under the
shared `IIdempotencyKeyStrategy` token — `useIdempotency` picks it up automatically, falling back to the
header/body-hash default only when none is registered:

```ts
import { IIdempotencyKeyStrategy } from '@benzene/idempotency';
import { ServiceBusContext } from '@benzene/azure-function-service-bus';

/** Keys de-duplication on the order id carried in the Service Bus application properties. */
export class OrderIdKeyStrategy implements IIdempotencyKeyStrategy<ServiceBusContext> {
  getKey(context: ServiceBusContext): string | undefined {
    const orderId = context.message.applicationProperties?.orderId;
    return typeof orderId === 'string' ? `order:${orderId}` : undefined;
  }
}

// Register it before wiring useIdempotency (in configureServices):
services.addScoped(IIdempotencyKeyStrategy, OrderIdKeyStrategy);
```

Returning `undefined` from `getKey` opts that message out of de-duplication — the middleware runs the
handler normally without touching the store.

## Step 4 — failure handling (retries still work)

Idempotency must not turn a transient failure into a permanently swallowed message. The middleware only
records a key as *completed* on success; every other outcome releases the claim so the transport's
redelivery reprocesses the message:

| First attempt | What happens |
|---|---|
| Handler succeeds | Key recorded **completed**; future duplicates short-circuit. |
| Handler **throws** | Claim **released**, error rethrown; the transport redelivers and reprocesses. |
| Handler reports an unsuccessful result (`context.messageResult.isSuccessful === false`) | Claim **released**; the transport redelivers and reprocesses. |

"Success" is read from the context's `messageResult` when the transport sets one (`ServiceBusContext`
implements `IHasMessageResult`); if there is no result, "the handler did not throw" counts as success.
When a completed duplicate is short-circuited, the middleware writes `BenzeneResult.ok()` onto the
context's `messageResult` so the duplicate is acknowledged and removed from the queue rather than
redelivered forever.

A duplicate that arrives while the first copy is *still in progress* is, by default, dropped
(`InProgressBehavior.Skip`) so the handler is never run twice concurrently. If losing a duplicate whose
sibling later fails is unacceptable, choose `Throw` instead — the middleware throws an
`IdempotencyConflictException`, the transport doesn't acknowledge the duplicate, and it's redelivered
once the sibling has finished:

```ts
import { useIdempotency, InProgressBehavior } from '@benzene/idempotency';

useIdempotency<ServiceBusContext>(sb, (options) => {
  options.inProgressBehavior = InProgressBehavior.Throw;
});
```

## Step 5 — a shared store for multi-instance deployments

`IIdempotencyStore` is three methods. Back it with anything that offers an **atomic** set-if-absent —
the whole guarantee rests on `tryClaimAsync` being atomic. There is no shipped Redis/DynamoDB store, so
you implement the interface yourself. A Redis implementation using `SET key value NX PX` (via `ioredis`,
the same client `@benzene/cache-redis` uses — see [Caching](../caching.md) for the connection setup you
can reuse):

```ts
import type { Redis } from 'ioredis';
import {
  IIdempotencyStore,
  ClaimResult,
  IdempotencyRecord,
  IdempotencyStatus,
} from '@benzene/idempotency';

export class RedisIdempotencyStore implements IIdempotencyStore {
  constructor(
    private readonly redis: Redis,
    private readonly timeToLiveMs: number,
  ) {}

  async tryClaimAsync(key: string): Promise<ClaimResult> {
    // Atomic claim: only succeeds if the key does not already exist.
    const won = await this.redis.set(key, 'in-progress', 'PX', this.timeToLiveMs, 'NX');
    if (won === 'OK') {
      return ClaimResult.won();
    }

    const value = await this.redis.get(key);
    const status =
      value === 'completed' ? IdempotencyStatus.Completed : IdempotencyStatus.InProgress;
    return ClaimResult.alreadyExists(
      new IdempotencyRecord(key, status, status === IdempotencyStatus.Completed),
    );
  }

  async completeAsync(key: string, wasSuccessful: boolean): Promise<void> {
    await this.redis.set(key, wasSuccessful ? 'completed' : 'failed', 'PX', this.timeToLiveMs);
  }

  async releaseAsync(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
```

Register it as the `IIdempotencyStore` instead of calling `addInMemoryIdempotencyStore`:

```ts
import { IIdempotencyStore } from '@benzene/idempotency';

services.addSingletonInstance(
  IIdempotencyStore,
  new RedisIdempotencyStore(redis, 24 * 60 * 60 * 1000),
);
```

The `IIdempotencyStore` methods each accept an optional `AbortSignal` (the port-wide mapping of C#'s
`CancellationToken`); forward it to your client calls if you want a caller-side cancellation to abort the
round trip. Keep the TTL long enough to outlive the transport's maximum redelivery window.

## Testing

`InMemoryIdempotencyStore` accepts an injected clock — `new InMemoryIdempotencyStore(ttlMs, () => now)`
— so you can test TTL expiry without waiting, and the middleware is a plain `IMiddleware<TContext>` you
can drive directly. The package's own suite
(`test/Benzene.Core.Test/Idempotency/`) is the best reference: first-delivery-processes,
duplicate-short-circuits, throw/failed-result-releases, in-progress Skip/Throw, and the key-derivation
cases. Driving the middleware directly with a fixed-key strategy:

```ts
import { describe, expect, it } from 'vitest';
import { IMessageResult } from '@benzene/abstractions-message-handlers';
import { BenzeneResult } from '@benzene/results';
import {
  IIdempotencyKeyStrategy,
  IdempotencyMiddleware,
  IdempotencyOptions,
  InMemoryIdempotencyStore,
} from '@benzene/idempotency';

class TestContext {
  messageResult: IMessageResult | undefined = undefined;
}

class FixedKeyStrategy implements IIdempotencyKeyStrategy<TestContext> {
  constructor(private readonly key: string | undefined) {}
  getKey(): string | undefined {
    return this.key;
  }
}

describe('idempotency', () => {
  it('runs the handler once and short-circuits the duplicate', async () => {
    const store = new InMemoryIdempotencyStore();
    let calls = 0;
    const next = () => {
      calls++;
      return Promise.resolve();
    };
    const build = () =>
      new IdempotencyMiddleware<TestContext>(store, new FixedKeyStrategy('key-1'), new IdempotencyOptions());

    await build().handleAsync(new TestContext(), next);
    await build().handleAsync(new TestContext(), next);

    expect(calls).toBe(1); // the second delivery is recognised as a duplicate
  });

  it('releases the claim when the handler reports failure, so a redelivery reprocesses', async () => {
    const store = new InMemoryIdempotencyStore();
    const ctx = new TestContext();
    const build = () =>
      new IdempotencyMiddleware<TestContext>(store, new FixedKeyStrategy('key-1'), new IdempotencyOptions());

    await build().handleAsync(ctx, () => {
      ctx.messageResult = BenzeneResult.unexpectedError();
      return Promise.resolve();
    });

    // The claim was released rather than completed — a redelivery gets a fresh claim.
    expect((await store.tryClaimAsync('key-1')).claimed).toBe(true);
  });
});
```

See [Testing Benzene](../testing-benzene.md) for the full testing guide and
[Mocking External Dependencies](mocking-dependencies.md) for faking a handler's own dependencies.

## Troubleshooting

- **Duplicates still slip through across instances** — you're on the in-memory store, which keeps its
  map per process. Move to a shared store (Step 5).
- **Nothing is being de-duplicated** — check a key is actually derived. With `hashBodyWhenNoHeader =
  false` and no `idempotency-key` header, the message is intentionally left untracked (the strategy
  returns `undefined`). Confirm `useIdempotency` is registered **before** `useMessageHandlers` on the
  same builder, and that an `IIdempotencyStore` is registered.
- **A legitimately-new message is treated as a duplicate** — you're hashing the body but the producer
  reuses an identical payload for distinct events; stamp a unique `idempotency-key` header at the
  producer instead, or register a custom `IIdempotencyKeyStrategy` that keys on a business identifier.
- **A failed message is never retried** — confirm the failure surfaces either as a thrown error or an
  unsuccessful `messageResult`. A handler that silently swallows an error and returns success records the
  key as completed, so the transport won't redeliver it.

## Variations

### De-dupe only messages that carry an explicit key

If you only trust producer-supplied keys and want everything else to flow through untracked, turn off
body hashing:

```ts
useIdempotency<ServiceBusContext>(sb, (options) => {
  options.hashBodyWhenNoHeader = false;
});
```

Messages without an `idempotency-key` header then derive no key and are processed normally every time.

### Namespace keys in a shared store

When several services share one store (e.g. one Redis), set `keyPrefix` per service so their keys can't
collide:

```ts
useIdempotency<ServiceBusContext>(sb, (options) => {
  options.keyPrefix = 'orders:';
});
```

## Further Reading

- [Handling SQS Message Failures](handling-sqs-failures.md) — partial-batch-failure reporting and
  in-process retry, the failure model idempotency's claim-release behaviour complements.
- [SNS Fan-Out Pattern](sns-fan-out.md) — broadcasting one event to multiple consumers, where each
  consumer needs its own idempotency guarantee.
- [Mocking External Dependencies](mocking-dependencies.md) — faking a handler's dependencies in vitest.
- [Message Handlers](../message-handlers.md) — the `@message` decorator, `IMessageHandler`, and
  `static inject`.
- [Message Results](../message-result.md) — the `BenzeneResult` factory, statuses, and `isSuccessful`.
- [Middleware](../middleware.md) — pipeline ordering and how a middleware wraps the handler.
- [Caching](../caching.md) — the `@benzene/cache-redis` / `ioredis` connection setup you can reuse for a
  Redis-backed store.
- [Resilience](../resilience.md) — in-process retry middleware that pairs with idempotency's
  claim-release on failure.

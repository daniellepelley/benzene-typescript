# Transactional Outbox

Publish a handler's event **atomically with its database write**, so a crash between "commit the order" and
"publish `order:created`" can never lose the event (or announce one that rolled back).

## Problem statement

[Response as Event](response-as-event.md) republishes a handler's response as an event by sending it
through `IBenzeneMessageSender` the moment the handler returns. That's a **dual write**: the handler commits
to its database, then a separate call publishes to SNS/SQS/EventBridge. If the process dies between the two,
you've committed the order but never announced it (or announced it but rolled back the order).

The **outbox pattern** removes the dual write: the handler writes the event into an *outbox table in the
same database transaction as the business data*, and a separate **relay** later reads that table and
publishes. One transaction, so the event and the data commit or roll back together; the relay gives you
at-least-once delivery.

Benzene doesn't ship an outbox — writing the outbox row inside *your* DB transaction is application
territory. But it's built to let you drop one in: the publish step behind `useResponseEvents` is the
swappable **`IResponseEventPublisher`** port, resolved from the same DI scope as your handler, so your
implementation shares the handler's database/transaction. This cookbook wires an outbox behind it.

## Prerequisites

- [Node.js 22+](https://nodejs.org/).
- `@benzenejs/response-events` and the [Response as Event](response-as-event.md) setup.
- A **scoped** database/unit-of-work whose transaction spans the whole message (see
  [Per-request transactions with a scoped Unit of Work](unit-of-work.md)).
- An outbound route per event topic (`addOutboundRouting`), for the relay to publish through — see
  [Clients](../clients.md).

## Installation

```bash
npm install @benzenejs/response-events @benzenejs/clients @benzenejs/core-message-handlers \
  @benzenejs/core-middleware @benzenejs/aws-lambda-core @benzenejs/aws-lambda-sqs \
  @benzenejs/results @benzenejs/abstractions @benzenejs/abstractions-message-handlers \
  @benzenejs/abstractions-middleware
```

The database types below (`IOrdersDb`, `OutboxMessage`) are **illustrative interfaces** — swap in your real
data layer (TypeORM, Prisma, a pooled `pg` client). The Benzene wiring around them is real.

## Step 1 — an outbox table and a scoped database

The database is registered **scoped** (one per message), so the handler and the outbox publisher resolve
the *same* instance and stage their writes on one pending transaction. `saveChangesAsync()` is the single
commit:

```ts
// db.ts (illustrative — model your real data layer this way)
import { serviceToken, ServiceToken } from '@benzenejs/abstractions';

export interface OutboxMessage {
  id: string;
  topic: string;
  payload: string; // serialized event
  headers: string; // serialized header map
  occurredOnUtc: string;
  publishedOnUtc?: string;
}

export interface IOrdersDb {
  /** Stage a business row (no commit yet). */
  addOrder(order: { id: string; total: number }): void;
  /** Stage an outbox row (no commit yet) — joins the same pending transaction. */
  addOutbox(message: OutboxMessage): void;
  /** Commit every staged row in ONE transaction. */
  saveChangesAsync(): Promise<void>;
  /** Read unsent outbox rows (used by the relay). */
  findUnsentOutboxAsync(limit: number): Promise<OutboxMessage[]>;
}

export const IOrdersDb: ServiceToken<IOrdersDb> = serviceToken<IOrdersDb>('IOrdersDb');
```

## Step 2 — an `IResponseEventPublisher` that writes to the outbox

Instead of sending, it **stages an outbox row on the same scoped `IOrdersDb`** the handler is using — no
`saveChangesAsync` here, so the row joins the handler's pending transaction. It reports `accepted` so the
message is acknowledged; the relay does the real send later:

```ts
// OutboxResponseEventPublisher.ts
import { IBenzeneResult } from '@benzenejs/abstractions';
import { IResponseEventPublisher } from '@benzenejs/response-events';
import { BenzeneResult } from '@benzenejs/results';
import { IOrdersDb } from './db.js';

export class OutboxResponseEventPublisher implements IResponseEventPublisher {
  static readonly inject = [IOrdersDb] as const;

  constructor(private readonly db: IOrdersDb) {}

  publishAsync(
    eventTopic: string,
    payload: unknown,
    headers?: Record<string, string>,
  ): Promise<IBenzeneResult> {
    this.db.addOutbox({
      id: crypto.randomUUID(),
      topic: eventTopic,
      payload: JSON.stringify(payload),
      headers: JSON.stringify(headers ?? {}),
      occurredOnUtc: new Date().toISOString(),
    });

    // Not sent yet — the relay does that. Report success so the message is acknowledged.
    return Promise.resolve(BenzeneResult.accepted());
  }
}
```

Register it — a plain `addScoped` overrides the default `IBenzeneMessageSender`-backed publisher
(`useResponseEvents` registers that one with a try-add, so yours wins):

```ts
import { IResponseEventPublisher } from '@benzenejs/response-events';
import { OutboxResponseEventPublisher } from './OutboxResponseEventPublisher.js';

services.addScoped(IResponseEventPublisher, OutboxResponseEventPublisher);
```

Because Benzene creates one DI scope per message and `IOrdersDb` is scoped, the outbox row and the business
data are pending on one instance.

## Step 3 — the handler stays a plain request/response handler

Nothing about it knows it will be republished — it just answers `order:create` with an `OrderCreated`
payload, staging the order on the scoped db **without committing** (standard unit-of-work discipline):

```ts
// CreateOrderHandler.ts
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { message } from '@benzenejs/core-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import { IOrdersDb } from './db.js';

export class CreateOrder {
  id: string | undefined;
  total = 0;
}
export class OrderCreated {
  id: string | undefined;
  total = 0;
}

@message('order:create', { requestType: CreateOrder, responseType: OrderCreated })
export class CreateOrderHandler implements IMessageHandler<CreateOrder, OrderCreated> {
  static readonly inject = [IOrdersDb] as const;

  constructor(private readonly db: IOrdersDb) {}

  handleAsync(request: CreateOrder): Promise<IBenzeneResultOf<OrderCreated>> {
    this.db.addOrder({ id: request.id!, total: request.total }); // staged, not committed
    const created = new OrderCreated();
    created.id = request.id;
    created.total = request.total;
    return Promise.resolve(BenzeneResult.created(created));
  }
}
```

## Step 4 — commit both in one transaction

The outbox row is written by the response-events middleware, which runs **after** the handler but **inside**
`useMessageHandlers`. So commit *once, at the end*, from a transport-pipeline step that wraps the handlers —
by then both the order and the outbox row are staged on the scoped db:

```ts
// UnitOfWorkMiddleware.ts
import { IMiddleware, NextFunc } from '@benzenejs/abstractions-middleware';
import { IOrdersDb } from './db.js';

export class UnitOfWorkMiddleware<TContext> implements IMiddleware<TContext> {
  readonly name = 'UnitOfWork';

  constructor(private readonly db: IOrdersDb) {}

  async handleAsync(_context: TContext, next: NextFunc): Promise<void> {
    await next(); //                    handler stages the order + outbox row (uncommitted)
    await this.db.saveChangesAsync(); // ONE transaction — data and event commit together
  }
}
```

> **Or reuse the shipped unit-of-work middleware.** The port ships `unitOfWorkMiddleware()` +
> `IUnitOfWork` (`@benzenejs/core-middleware`) which does exactly this commit-on-success / rollback-on-throw
> around a scoped `IUnitOfWork` — see [Per-request transactions](unit-of-work.md). Implement `IUnitOfWork`
> over your `IOrdersDb` and use it instead of the hand-rolled middleware above if you want rollback handling
> and the async-dispose safety net for free.

Wire it **before** the handlers. The `.use((resolver) => ...)` factory runs per message with that message's
scoped resolver, so it binds the correct per-message `IOrdersDb`:

```ts
// index.ts
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneConfiguration, BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene, useMessageHandlersWithRouter } from '@benzenejs/core-message-handlers';
import { AwsLambdaHost, useAwsLambda } from '@benzenejs/aws-lambda-core';
import { useSqs, SqsMessageContext } from '@benzenejs/aws-lambda-sqs';
import { addOutboundRouting } from '@benzenejs/clients';
import { IResponseEventPublisher, useResponseEvents } from '@benzenejs/response-events';
import { CreateOrderHandler } from './CreateOrderHandler.js';
import { OutboxResponseEventPublisher } from './OutboxResponseEventPublisher.js';
import { UnitOfWorkMiddleware } from './UnitOfWorkMiddleware.js';
import { IOrdersDb } from './db.js';
import { registerOrdersDb } from './registerOrdersDb.js'; // your scoped IOrdersDb registration
import { registerOrderEventsRoute } from './outbound.js'; // routes 'order:created' (see below)

export class StartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    addBenzene(services);
    registerOrdersDb(services); // services.addScoped(IOrdersDb, ...)
    registerOrderEventsRoute(services); // addOutboundRouting(... 'order:created' ...)
    services.addScoped(IResponseEventPublisher, OutboxResponseEventPublisher); // outbox behind the seam
  }

  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useAwsLambda(app, (aws) =>
      useSqs(aws, (sqs) => {
        sqs.use((resolver) => new UnitOfWorkMiddleware<SqsMessageContext>(resolver.getService(IOrdersDb)));
        useMessageHandlersWithRouter(
          sqs,
          (router) => useResponseEvents(router, (events) => events.map('order:create', 'order:created')),
          CreateOrderHandler,
        );
      }),
    );
  }
}

export const handler = new AwsLambdaHost(StartUp).lambdaHandler;
```

## Step 5 — the relay

A worker polls the outbox and publishes unsent rows through `IBenzeneMessageSender` (so they ride the
normal outbound routes — retry, correlation/trace stamping, transport choice). It creates a fresh DI **scope
per pass** via `IServiceResolverFactory.createScope()` — the same scope mechanism every transport uses per
message:

```ts
// OutboxRelay.ts
import { IServiceResolverFactory, VoidResult } from '@benzenejs/abstractions';
import { IBenzeneMessageSender } from '@benzenejs/clients';
import { IOrdersDb } from './db.js';

export class OutboxRelay {
  constructor(private readonly resolverFactory: IServiceResolverFactory) {}

  async runOnceAsync(): Promise<void> {
    const scope = this.resolverFactory.createScope();
    try {
      const db = scope.getService(IOrdersDb);
      const sender = scope.getService(IBenzeneMessageSender);

      const pending = await db.findUnsentOutboxAsync(100);
      for (const message of pending) {
        const payload = JSON.parse(message.payload) as unknown;
        const headers = JSON.parse(message.headers) as Record<string, string>;

        const result = await sender.sendAsync<unknown, VoidResult>(message.topic, payload, headers);
        if (result.isSuccessful) {
          message.publishedOnUtc = new Date().toISOString(); // mark sent (persist via your db)
        }
      }

      await db.saveChangesAsync();
    } finally {
      await scope.disposeAsync?.();
    }
  }
}
```

Drive `runOnceAsync()` on a timer (its own process/deployment for isolation, or co-located with the app —
it only needs the scoped `IOrdersDb` and `addOutboundRouting`). The outbound route for `order:created` is an
ordinary fire-and-forget route, e.g. SNS:

```ts
// outbound.ts
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { addOutboundRouting } from '@benzenejs/clients';
import { useSns } from '@benzenejs/clients-aws-sns';
import { SNSClient } from '@aws-sdk/client-sns';

export function registerOrderEventsRoute(services: IBenzeneServiceContainer): void {
  const sns = new SNSClient({});
  addOutboundRouting(services, (routing) =>
    routing.route('order:created', (pipeline) =>
      useSns(pipeline, process.env.ORDER_EVENTS_TOPIC_ARN!, sns),
    ),
  );
}
```

## Testing

- **Publisher** — call `publishAsync` on an `OutboxResponseEventPublisher` backed by a fake `IOrdersDb`;
  assert a row was staged and `saveChangesAsync` was **not** called.
- **Atomicity** — drive the SQS pipeline end-to-end with `benzeneTestHost` against a fake db, make the
  handler throw after staging the order, and assert `saveChangesAsync` never ran (neither the order nor the
  outbox row committed). See [Testing Benzene](../testing-benzene.md).
- **Relay** — seed one unsent row, run `runOnceAsync()` with a `FakeBenzeneMessageSender`
  (`@benzenejs/testing`), and assert it sent and stamped `publishedOnUtc`.

```ts
import { describe, expect, it } from 'vitest';
import { OutboxResponseEventPublisher } from '../src/OutboxResponseEventPublisher.js';
import type { IOrdersDb, OutboxMessage } from '../src/db.js';

describe('outbox publisher', () => {
  it('stages an outbox row without committing', async () => {
    const staged: OutboxMessage[] = [];
    let saved = 0;
    const db = {
      addOrder: () => {},
      addOutbox: (m: OutboxMessage) => staged.push(m),
      saveChangesAsync: () => {
        saved++;
        return Promise.resolve();
      },
      findUnsentOutboxAsync: () => Promise.resolve([]),
    } satisfies IOrdersDb;

    const publisher = new OutboxResponseEventPublisher(db);
    const result = await publisher.publishAsync('order:created', { id: 'o-1', total: 10 });

    expect(result.isSuccessful).toBe(true);
    expect(staged).toHaveLength(1);
    expect(staged[0]!.topic).toBe('order:created');
    expect(saved).toBe(0); // the relay commits, not the publisher
  });
});
```

## Variations & gotchas

- **At-least-once, not exactly-once.** The relay can publish then crash before stamping the row →
  redelivery. Consumers (and the handler) must be idempotent — see [Idempotency](idempotency.md).
- **Ordering.** Order the relay read by `occurredOnUtc` for best-effort order; for strict per-entity order,
  partition by an aggregate key and publish those in sequence.
- **Throughput.** Poll in batches (above) or switch to a push trigger (Postgres `LISTEN/NOTIFY`, CDC) to
  cut latency.
- **Cleanup.** Delete or archive rows past a retention window so the table stays small.
- **Not using response-events?** The same `OutboxMessage` + relay works if the handler stages the outbox
  row directly; the `IResponseEventPublisher` seam just lets the *response-as-event* mapping feed the outbox
  instead of publishing inline, with no handler code change.

## See also

- [Response as Event](response-as-event.md) — the inline (non-durable) version this hardens, and the
  `IResponseEventPublisher` seam it plugs into.
- [Per-request transactions with a scoped Unit of Work](unit-of-work.md) — the scoped transaction and the
  shipped `unitOfWorkMiddleware()` / `IUnitOfWork` you can commit through.
- [Idempotency](idempotency.md) — required for the at-least-once consumers a relay implies.
- [SNS Fan-Out Pattern](sns-fan-out.md) — a common relay destination.
- [Clients](../clients.md) — outbound routing and `IBenzeneMessageSender.sendAsync` the relay publishes through.
</content>

# Response as Event

Turn a request/response handler's response payload into a follow-up event — e.g. an SQS-triggered
`order:create` handler returns an `OrderCreated` payload, and the pipeline broadcasts it on
`order:created`.

## Problem Statement

On a queue transport there is no reply channel: whatever payload your handler returns is dropped
after the message is acknowledged. But that payload is often exactly the event the rest of your
system wants — "the order *was* created, here it is." Publishing it by hand from inside the handler
works, but couples the handler to messaging concerns and repeats the same boilerplate in every
handler.

`useResponseEvents` (in `@benzene/response-events`) does this declaratively: the handler stays a pure
request/response handler (reusable on HTTP, where the same payload *is* the response body), and the
pipeline decides that on this transport, the response becomes an event.

## Prerequisites

- [Node.js 22+](https://nodejs.org/).
- A queue-triggered Benzene pipeline (SQS, Service Bus, Kafka, ...). The examples here use
  [`@benzene/aws-lambda-sqs`](handling-sqs-failures.md).
- An outbound route for each event topic, registered with `addOutboundRouting` — see
  [Clients](../clients.md).

## Installation

```bash
npm install @benzene/response-events @benzene/clients @benzene/core-message-handlers \
  @benzene/results @benzene/abstractions @benzene/abstractions-message-handlers
```

## Step-by-Step Implementation

### 1. Keep the handler a plain request/response handler

Nothing about the handler knows it will be republished — it just answers `order:create` with an
`OrderCreated` payload, exactly as it would when hosted on HTTP.

```ts
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { IOrderRepository } from './OrderRepository.js';

export class CreateOrderRequest {
  customerId?: string;
  total?: number;
}

export class OrderCreated {
  id?: string;
  total?: number;
}

@message('order:create', { requestType: CreateOrderRequest, responseType: OrderCreated })
export class CreateOrderHandler implements IMessageHandler<CreateOrderRequest, OrderCreated> {
  static readonly inject = [IOrderRepository] as const;

  constructor(private readonly orders: IOrderRepository) {}

  async handleAsync(request: CreateOrderRequest): Promise<IBenzeneResultOf<OrderCreated>> {
    const order = await this.orders.createAsync(request);
    const created = new OrderCreated();
    created.id = order.id;
    created.total = order.total;
    return BenzeneResult.created(created);
  }
}
```

### 2. Route the event topic outbound

The published event goes through the normal [outbound routing](../clients.md), so it gets startup
validation and whatever cross-cutting middleware (retry, correlation/trace header stamping) you add to
the route — like any other `sendAsync`. The default publisher sends the event through
`IBenzeneMessageSender`, so **every event topic must have a route**.

> **Port status.** The broker route extensions (`useSns`, `useSqs`, `useEventBridge`, `useServiceBus`,
> `useEventHub`, `useEventGrid`, `useQueueStorage`, `usePubSub`) that plug a specific transport into an
> outbound route **are ported** — see the [Clients port-status table](../clients.md). In new code, prefer
> the route extension: `useSns(route, topicArn, snsClient)` converts the route's terminal send to SNS (and
> auto-wires a reachability check) in one line. The hand-rolled SNS-SDK middleware below predates those
> extensions and is kept as an illustration of a fully custom terminal `IMiddleware<OutboundContext>` — it
> publishes to SNS with the AWS SDK directly (as the [SNS Fan-Out](sns-fan-out.md) cookbook does on the
> publish side) and sets a `VoidResult` acknowledgement on the context, since event routes are
> fire-and-forget (the publisher expects a `VoidResult` back, not a typed response).

```ts
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { addOutboundRouting, OutboundContext } from '@benzene/clients';
import { BenzeneResult } from '@benzene/results';

class PublishOrderCreatedToSns implements IMiddleware<OutboundContext> {
  readonly name = 'PublishOrderCreatedToSns';
  private readonly sns = new SNSClient({});

  async handleAsync(context: OutboundContext, _next: NextFunc): Promise<void> {
    await this.sns.send(
      new PublishCommand({
        TopicArn: process.env.ORDER_EVENTS_TOPIC_ARN,
        Message: JSON.stringify(context.request),
        MessageAttributes: {
          topic: { DataType: 'String', StringValue: context.topic },
        },
      }),
    );
    // Fire-and-forget acknowledgement: the default publisher sends via sendAsync<_, VoidResult>.
    context.response = BenzeneResult.accepted();
  }
}

export function registerOutboundRoutes(services: IBenzeneServiceContainer): void {
  addOutboundRouting(services, (routing) =>
    routing.route('order:created', (pipeline) => pipeline.useService(PublishOrderCreatedToSns)),
  );
}
```

### 3. Map the response to the event, per pipeline

Wire the mapping inside the SQS pipeline's message-router callback. `useResponseEvents` takes the
router builder (from `useMessageHandlersWithRouter`) and adds the response-events middleware after
handler dispatch:

```ts
import { InlineAwsLambdaStartUp, toLambdaHandler } from '@benzene/aws-lambda-core';
import { useSqs } from '@benzene/aws-lambda-sqs';
import { addBenzene, useMessageHandlersWithRouter } from '@benzene/core-message-handlers';
import { useResponseEvents } from '@benzene/response-events';
import { CreateOrderHandler } from './CreateOrderHandler.js';
import { registerOutboundRoutes } from './outbound.js';

const entryPoint = new InlineAwsLambdaStartUp()
  .configureServices((services) => {
    addBenzene(services);
    registerOutboundRoutes(services);
  })
  .configure((app) =>
    useSqs(app, (sqs) =>
      useMessageHandlersWithRouter(
        sqs,
        (router) => useResponseEvents(router, (events) => events.map('order:create', 'order:created')),
        CreateOrderHandler,
      ),
    ),
  )
  .build();

export const handler = toLambdaHandler(entryPoint);
```

That's it. After `CreateOrderHandler` returns a successful result with a payload, the payload is
published on `order:created`. On any other pipeline hosting the same handler (say, HTTP) nothing
changes — the mapping belongs to the SQS pipeline only.

## Configuration Options

### Conditional publishing

By default a mapping fires on any successful result that carries a payload. Pass a `when` predicate to
narrow it (the third argument to `map` — the port passes it positionally rather than as a C# named
argument):

```ts
import { BenzeneResultStatus } from '@benzene/results';

useResponseEvents(router, (events) =>
  events.map('order:create', 'order:created', (result) => result.status === BenzeneResultStatus.created),
);
```

The payload requirement always applies — a successful result with no payload never publishes, `when`
or not.

### Declaring the payload type (specs) and reshaping the payload

`mapWithPayload<TPayload>` declares the event's payload type — which also surfaces the event in
generated specs via `ResponseEventCatalog` — and can project the response into a different event shape.
Because TypeScript erases generics, the payload type is passed explicitly as a class constructor:

```ts
useResponseEvents(router, (events) =>
  events.mapWithPayload(
    OrderCreated,
    'order:create',
    'order:created',
    undefined, // no `when` predicate
    (order) => new OrderCreatedNotification(order.id),
  ),
);
```

Returning `undefined`/`null` from the projector skips the publish for that message.

### CRUD naming convention

`mapCrudConvention()` adds one rule covering every CRUD topic on the pipeline: `X:create`/`X:update`/
`X:delete` handled with status `created`/`updated`/`deleted` publishes the payload on
`X:created`/`X:updated`/`X:deleted`:

```ts
useResponseEvents(router, (events) => events.mapCrudConvention());
```

### Custom rules

Anything the built-ins can't express is an `IResponseEventMapping` implementation added via
`events.add(new MyMapping())` — a mapping's `resolve(sourceTopic, result)` receives the topic and the
handler's full result and returns a `ResponseEventPublication` (event topic + payload) or `undefined`:

```ts
import { IBenzeneResult } from '@benzene/abstractions';
import { ITopic } from '@benzene/abstractions-messages';
import { IResponseEventMapping, ResponseEventPublication } from '@benzene/response-events';

class ArchiveHighValueOrders implements IResponseEventMapping {
  readonly description = 'order:create -> order:archived (when total > 10_000)';
  readonly sourceTopic = 'order:create';
  readonly eventTopic = 'order:archived';
  readonly payloadType = undefined;

  resolve(sourceTopic: ITopic, result: IBenzeneResult): ResponseEventPublication | undefined {
    if (sourceTopic.id !== this.sourceTopic || !result.isSuccessful) {
      return undefined;
    }
    const order = result.payloadAsObject as { total?: number };
    return (order?.total ?? 0) > 10_000
      ? new ResponseEventPublication(this.eventTopic, order)
      : undefined;
  }

  covers(topic: ITopic): boolean {
    return topic.id === this.sourceTopic;
  }
}
```

### Publish failure behavior

By default (`PublishFailureMode.FailMessage`) a failed publish replaces the handler's response with an
`unexpectedError`, so the transport reports the message as failed and the queue redelivers it. **This
is at-least-once delivery: the handler re-runs on redelivery, so the handler and the event's consumers
must be idempotent.** If the event is best-effort, opt out with `onPublishFailure`:

```ts
import { PublishFailureMode } from '@benzene/response-events';

useResponseEvents(router, (events) =>
  events.map('order:create', 'order:created').onPublishFailure(PublishFailureMode.LogAndContinue),
);
```

`LogAndContinue` logs a warning and keeps the handler's response — the message is acknowledged even
though the event was lost.

## Introspection

Every mapping is plain data. Resolve `IResponseEventCatalog` to see exactly what the service
republishes, across all pipelines:

```ts
import { IResponseEventCatalog } from '@benzene/response-events';

const catalog = resolver.getService(IResponseEventCatalog);
for (const mapping of catalog.mappings) {
  console.log(mapping.description); // e.g. "order:create -> order:created (OrderCreated)"
}
```

Mappings declared with `mapWithPayload` also appear in generated specs: the catalog is registered as an
`IMessageDefinitionFinder<IMessageDefinition>`, and its `findDefinitions()` yields one published-event
definition per declared mapping (plus any declaration-only events registered with
`addResponseEventDeclarations`).

## Catching a forgotten mapping

A request/response handler that returns a payload but runs on a fire-and-forget transport with no
mapping silently drops that payload — the classic "I wrote `IMessageHandler<CreateOrderRequest,
OrderCreated>`, deployed it on SQS, and my event vanished" mistake. An opt-in startup diagnostic
surfaces it. Call it once after wiring, against the resolved container:

```ts
import { findUnmappedResponseHandlers, logUnmappedResponseHandlers } from '@benzene/response-events';

const gaps = logUnmappedResponseHandlers(resolver); // logs a warning per gap, returns them
// or, to decide yourself:
for (const gap of findUnmappedResponseHandlers(resolver)) {
  console.log(gap.description);
}
```

Each `ResponseEventGap` names the handler, topic, and response type of a response-returning handler no
mapping covers. It's **advisory, never throws** — because a Benzene handler is transport-agnostic, the
same handler legitimately returns its response as the reply over HTTP and (maybe) drops it over SQS, and
registration alone can't tell which you meant. Treat the list as "did I forget a mapping?": map the ones
whose response should become an event, ignore any topic served only over HTTP. To gate CI, fail when the
(filtered) list is non-empty.

## Swapping the publisher

The middleware publishes through the `IResponseEventPublisher` port; the default implementation
(`BenzeneMessageSenderResponseEventPublisher`) sends via `IBenzeneMessageSender`. Replace the scoped
registration to publish differently — a test fake, a custom fan-out, or an outbox relay:

```ts
import { IResponseEventPublisher } from '@benzene/response-events';

services.addScoped(IResponseEventPublisher, MyOutboxPublisher);
```

A publisher just implements one method:

```ts
import { IBenzeneResult } from '@benzene/abstractions';
import { IResponseEventPublisher } from '@benzene/response-events';

class MyOutboxPublisher implements IResponseEventPublisher {
  publishAsync(eventTopic: string, payload: unknown): Promise<IBenzeneResult> {
    // ...enqueue to an outbox table, return an accepted/failed result...
  }
}
```

## Testing

The reference is `test/Benzene.Core.Test/ResponseEvents/ResponseEventsPipelineTest.test.ts`: drive
`ResponseEventsMiddleware` directly against a capturing `IResponseEventPublisher` (the publish seam the
middleware actually uses) and assert what it published — no live transport needed.

```ts
import { describe, expect, it } from 'vitest';
import { IBenzeneResult, IBenzeneResultOf, IServiceResolver, ServiceIdentifier } from '@benzene/abstractions';
import { IMessageHandlerContext } from '@benzene/abstractions-message-handlers';
import { Topic } from '@benzene/core-messages';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import {
  IResponseEventPublisher,
  ResponseEventsBuilder,
  ResponseEventsMiddleware,
} from '@benzene/response-events';

class OrderPayload {
  id?: number;
}

class CapturingPublisher implements IResponseEventPublisher {
  readonly published: { eventTopic: string; payload: unknown }[] = [];
  publishAsync(eventTopic: string, payload: unknown): Promise<IBenzeneResult> {
    this.published.push({ eventTopic, payload });
    return Promise.resolve(BenzeneResult.accepted());
  }
}

function resolverWith(publisher: IResponseEventPublisher): IServiceResolver {
  return {
    getService: <T>(id: ServiceIdentifier<T>): T => {
      if (id === IResponseEventPublisher) return publisher as T;
      throw new Error('not registered');
    },
    tryGetService: () => undefined,
    getServices: () => [],
    dispose: () => {},
  };
}

describe('CreateOrder response as event', () => {
  it('publishes order:created for a Created result carrying a payload', async () => {
    const publisher = new CapturingPublisher();
    const mappings = new ResponseEventsBuilder().map('order:create', 'order:created').build();
    const middleware = new ResponseEventsMiddleware<OrderPayload, OrderPayload>(
      mappings,
      resolverWith(publisher),
    );

    const payload = new OrderPayload();
    payload.id = 42;
    const context = {
      topic: new Topic('order:create'),
      handlerType: undefined,
      request: new OrderPayload(),
      response: undefined as unknown as IBenzeneResultOf<OrderPayload>,
    } satisfies IMessageHandlerContext<OrderPayload, OrderPayload>;

    await middleware.handleAsync(context, () => {
      context.response = BenzeneResult.created(payload);
      return Promise.resolve();
    });

    expect(context.response.status).toBe(BenzeneResultStatus.created); // handler response kept
    expect(publisher.published).toHaveLength(1);
    expect(publisher.published[0]!.eventTopic).toBe('order:created');
    expect((publisher.published[0]!.payload as OrderPayload).id).toBe(42);
  });
});
```

To exercise the failure path, feed the middleware a publisher that returns
`BenzeneResult.unexpectedError(...)` and assert the response is replaced (under the default
`FailMessage`) or kept (under `LogAndContinue`). See [Testing Benzene](../testing-benzene.md) for the
full guide.

## Gotchas

- **Every event topic needs an outbound route.** An unrouted topic throws `UnroutedTopicException` at
  publish time, which surfaces per your `PublishFailureMode`.
- **Event routes should be fire-and-forget transports** (SQS, SNS, EventBridge, Kafka...). The default
  publisher sends `sendAsync<_, VoidResult>`, so a route that produces a typed response instead of a
  `VoidResult` acknowledgement throws `OutboundResponseTypeMismatchException` — register a custom
  `IResponseEventPublisher` for such routes.
- **No-response handlers (`IMessageHandler<TRequest>`) never publish** — they produce an `accepted`
  result with no payload, and a mapping never fires without a payload.
- **This is not an outbox.** The publish happens after the handler's work, in the same invocation; a
  crash between the two can drop the event (or, with `FailMessage`, re-run the handler). If you need the
  event to commit atomically with the DB write, put an outbox behind `IResponseEventPublisher` (see
  "Swapping the publisher").

## Related

- [SNS Fan-Out Pattern](sns-fan-out.md) — publishing the same event to many independent consumers.
- [Handling SQS Message Failures](handling-sqs-failures.md) — the queue transport and its redelivery
  semantics that `FailMessage` relies on.
- [Clients](../clients.md) — outbound routing, `IBenzeneMessageSender`, and how the default publisher
  sends events.
- [Message Handlers](../message-handlers.md) — the request/response handler this republishes.
- [Message Results](../message-result.md) — the `BenzeneResult` factory and statuses mappings key off.

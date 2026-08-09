# Express HTTP + SQS + SNS

Serve HTTP through an Express application that publishes domain events to SNS, and consume those events in
a separate SQS worker — the *same* Benzene message handlers on both sides, connected by a durable
SNS → SQS fan-out.

## Problem Statement

You have an HTTP service (built on Express) that accepts an order and needs to hand it off to a background
worker for fulfilment. You want:

- The HTTP front door to **publish a domain event** (`order:placed`) rather than call the worker directly,
  so producers and consumers stay decoupled.
- A **queue in front of the worker** for durability and backpressure, not a raw fire-and-forget notify.
- Both sides written as ordinary Benzene message handlers — nothing about them tied to Express, SNS, or
  SQS.

> **Port shape differs from .NET.** The .NET cookbook runs ASP.NET Core **and** the SQS/SNS consumers in
> **one Lambda process, one DI container** (`Benzene.Aws.Lambda.AspNet`'s HTTP bridge). The TypeScript port
> has no in-process HTTP-plus-queue bridge: Express is a long-running host and the queue consumer is a
> long-running `@benzene/self-host` worker, so they are **two deployables**. The idiomatic TS topology is
> the durable **SNS → SQS** fan-out below — the HTTP service publishes to SNS, and the worker consumes an
> SQS queue subscribed to that topic. This is the same decoupling the .NET single-process version gives
> you, just across two processes. See [Hosting](../hosting.md) for the execution models.

```
POST /orders ──► Express service ──► SNS topic ──► SQS queue ──► SQS worker
   (@benzene/express)   (publish order:placed)          (poll, route to handler)
```

## Prerequisites

- [Node.js 22+](https://nodejs.org/).
- An SNS topic, an SQS queue, and an SNS → SQS subscription (see [step 4](#4-wire-sns--sqs)).

## Installation

The Express HTTP service:

```bash
npm install @benzene/express @benzene/core-message-handlers @benzene/http @benzene/results \
  @benzene/dependencies @benzene/clients @benzene/clients-aws-sns \
  @benzene/abstractions @benzene/abstractions-message-handlers \
  express @aws-sdk/client-sns
```

The SQS consumer worker (a separate deployable):

```bash
npm install @benzene/self-host @benzene/aws-sqs @benzene/core-message-handlers @benzene/results \
  @benzene/abstractions @benzene/abstractions-message-handlers @aws-sdk/client-sqs
```

## Step-by-Step Implementation

### 1. The shared event contract

Both sides agree on the topic and payload — the only thing they share. Payloads are classes (the runtime
recovers the erased request type from the constructor):

```ts
// events.ts (shared, or duplicated on each side)
export class OrderPlaced {
  orderId?: string;
  sku?: string;
}
```

### 2. The Express service: an HTTP handler that publishes to SNS

The HTTP handler depends only on `IBenzeneMessageSender` (`@benzene/clients`) — the transport-agnostic
outbound port. It sends on the `order:placed` topic; a route registered at startup carries that topic to
SNS. Nothing in the handler mentions SNS:

```ts
// handlers.ts
import { IBenzeneResultOf, VoidResult } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { BenzeneResult } from '@benzene/results';
import { IBenzeneMessageSender } from '@benzene/clients';
import { OrderPlaced } from './events.js';

export class PlaceOrder {
  customerId?: string;
  sku?: string;
}

export class OrderAccepted {
  orderId?: string;
}

@httpEndpoint('POST', '/orders')
@message('order:place', { requestType: PlaceOrder, responseType: OrderAccepted })
export class PlaceOrderHandler implements IMessageHandler<PlaceOrder, OrderAccepted> {
  static readonly inject = [IBenzeneMessageSender] as const;

  constructor(private readonly sender: IBenzeneMessageSender) {}

  async handleAsync(request: PlaceOrder): Promise<IBenzeneResultOf<OrderAccepted>> {
    const orderId = `order-${request.customerId ?? 'anon'}`;

    const event = new OrderPlaced();
    event.orderId = orderId;
    event.sku = request.sku;

    // Publish the domain event. `order:placed` is a fire-and-forget event, so the response is a VoidResult.
    await this.sender.sendAsync<OrderPlaced, VoidResult>('order:placed', event);

    const accepted = new OrderAccepted();
    accepted.orderId = orderId;
    return BenzeneResult.created(accepted);
  }
}
```

Wire the Express app. `addOutboundRouting` registers the `order:placed` route, and `useSns` (from
`@benzene/clients-aws-sns`) makes that route's terminal step a `PublishCommand` to your topic. The route is
registered on the **same container** you hand to `benzene(...)`, so the handler resolves
`IBenzeneMessageSender` from it:

```ts
// index.ts
import express from 'express';
import { SNSClient } from '@aws-sdk/client-sns';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { benzene } from '@benzene/express';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { addOutboundRouting } from '@benzene/clients';
import { useSns } from '@benzene/clients-aws-sns';
import { PlaceOrderHandler } from './handlers.js';

const app = express();
const container = new DefaultBenzeneServiceContainer();
const sns = new SNSClient({});

// Build the outbound route once: sending on `order:placed` publishes to the SNS topic.
addOutboundRouting(container, (routing) =>
  routing.route('order:placed', (pipeline) => useSns(pipeline, process.env.ORDER_EVENTS_TOPIC_ARN!, sns)),
);

// Mount Benzene BEFORE any body parser so it reads the raw request body.
app.use(benzene((pipeline) => useMessageHandlers(pipeline, PlaceOrderHandler), { container }));

app.listen(3000, () => console.log('Listening on http://localhost:3000'));
```

`useSns(pipeline, topicArn, sns)` converts the outbound route to publish via SNS: the routed message
becomes the SNS message body, and the topic is written to the `topic` message attribute (the reserved key
every Benzene subscriber routes on). It also auto-registers a non-destructive SNS reachability check for
the topic on the deep `healthcheck` layer — pass a trailing `false` to opt out. See
[Clients](../clients.md#basic-usage).

### 3. The SQS worker: consume the event from a queue

The consumer is a separate deployable: a long-running `@benzene/self-host` worker that polls an SQS queue
and routes each message to a handler by its `topic` message attribute. The handler is an ordinary Benzene
message handler keyed on the same `order:placed` topic:

```ts
// NotifyWarehouseHandler.ts
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { OrderPlaced } from './events.js';

export class WarehouseAck {
  accepted?: boolean;
}

@message('order:placed', { requestType: OrderPlaced, responseType: WarehouseAck })
export class NotifyWarehouseHandler implements IMessageHandler<OrderPlaced, WarehouseAck> {
  async handleAsync(request: OrderPlaced): Promise<IBenzeneResultOf<WarehouseAck>> {
    // ...notify the warehouse for request.orderId / request.sku (idempotently — see below)
    const ack = new WarehouseAck();
    ack.accepted = true;
    return BenzeneResult.ok(ack);
  }
}
```

Host it on a worker. `useSqs` (from `@benzene/aws-sqs`) adds a long-running `SqsConsumer` that long-polls
the queue and runs each message through the pipeline; `SqsClientFactory` wraps an AWS SDK v3 `SQSClient`:

```ts
// worker.ts
import { SQSClient } from '@aws-sdk/client-sqs';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { SqsClientFactory, useSqs } from '@benzene/aws-sqs';
import { InlineSelfHostedStartUp } from '@benzene/self-host';
import { NotifyWarehouseHandler } from './NotifyWarehouseHandler.js';

const worker = new InlineSelfHostedStartUp()
  .configure((workers) =>
    useSqs(
      workers,
      { queueUrl: process.env.ORDER_QUEUE_URL!, maxNumberOfMessages: 10 },
      new SqsClientFactory(new SQSClient({})),
      (pipeline) => useMessageHandlers(pipeline, NotifyWarehouseHandler),
    ),
  )
  .build();

await worker.startAsync();

// Keep the process alive; drain in-flight work on shutdown.
process.on('SIGTERM', () => void worker.stopAsync());
```

`useSqs` registers Benzene's base services itself, so a worker that only hosts ready-made consumers needs
no separate `addBenzene` step. The consumer reads the topic from the `topic` message attribute by default;
if a queue is fed by a non-Benzene producer that never sets one, set `topicAttributeKey` on the config or
route every message to a fixed topic. See [Hosting: ready-made consumers](../hosting.md#ready-made-self-hosted-consumers).

### 4. Wire SNS → SQS

The two services are joined by infrastructure: an SNS subscription that delivers to the SQS queue. Benzene
ships no infrastructure generator, so this is your own IaC. The one setting that matters for Benzene:
**enable raw message delivery** on the subscription, so the message body and the `topic` message attribute
pass through to SQS unwrapped (rather than nested inside SNS's JSON envelope) — that's what lets the SQS
consumer read the `topic` attribute and deserialize the body directly.

```hcl
resource "aws_sns_topic_subscription" "orders_to_queue" {
  topic_arn            = aws_sns_topic.order_events.arn
  protocol             = "sqs"
  endpoint             = aws_sqs_queue.orders.arn
  raw_message_delivery = true   # pass body + `topic` attribute straight through to SQS
}
```

Give the queue a policy allowing the topic to send to it, and (recommended) a redrive policy to a
dead-letter queue. Now a `POST /orders` on the Express service publishes `order:placed` to the topic, SNS
delivers it to the queue, and the worker picks it up and runs `NotifyWarehouseHandler`.

## Testing

Test each side in-process, no cloud required.

**The HTTP handler** — inject the first-party `FakeBenzeneMessageSender` (`@benzene/testing`), which
captures what a service published instead of sending anywhere, and assert on the topic and payload:

```ts
// test/placeOrder.test.ts
import { describe, expect, it } from 'vitest';
import { FakeBenzeneMessageSender } from '@benzene/testing';
import { PlaceOrder, PlaceOrderHandler } from '../src/handlers.js';

describe('PlaceOrderHandler', () => {
  it('publishes order:placed and returns 201', async () => {
    const sender = new FakeBenzeneMessageSender();
    const handler = new PlaceOrderHandler(sender);

    const request = new PlaceOrder();
    request.customerId = 'acme';
    request.sku = 'widget';

    const result = await handler.handleAsync(request);

    expect(sender.lastTopic).toBe('order:placed');
    expect((sender.lastRequest as { orderId?: string }).orderId).toBe('order-acme');
    expect(result.payload?.orderId).toBe('order-acme');
  });
});
```

**The worker handler** — drive it directly (it's an ordinary handler), or exercise the whole SQS pipeline
with the `@benzene/aws-sqs-test-helpers` builders. See [Testing Benzene](../testing-benzene.md) and
[Mocking External Dependencies](mocking-dependencies.md).

## Troubleshooting

**The worker never receives anything.** Confirm the SNS → SQS subscription exists and the topic's policy
lets it deliver to the queue. Then confirm **raw message delivery** is enabled — without it, SNS wraps the
body in its own JSON envelope, so the SQS consumer can't read the `topic` attribute or deserialize your
payload.

**The message arrives but routes to no handler.** The SQS consumer routes on the `topic` message attribute
(default key `topic`). `useSns` sets it to `order:placed`; the worker handler must declare
`@message('order:placed', …)`. If the queue is fed by a non-Benzene producer, it won't set a `topic`
attribute — configure a preset topic or a custom `topicAttributeKey`.

**`UnroutedTopicException` from the HTTP service.** The handler sent a topic with no registered outbound
route — check the topic string in `sendAsync(...)` matches the one in `routing.route('order:placed', …)`.

**Duplicate side effects in the worker.** SNS → SQS delivery is at-least-once, so the same event can arrive
more than once. Make `NotifyWarehouseHandler` idempotent — see [Idempotency](idempotency.md).

## Variations

### Publish to more than one transport at once

If several consumers need the event over different transports, fan a single topic out to all of them with
`useParallel` inside the route (all-must-succeed). See [Clients: parallel fan-out](../clients.md#parallel-fan-out-useparallel).

### Handle partial batch failures in the worker

For all-or-nothing vs. per-message deletion semantics on the SQS consumer, set `ackMode` on the
`SqsConsumerOptions` (the optional `configure` callback of `useSqs`). For the Lambda-delivered SQS variant
and its `ReportBatchItemFailures` reporting, see [Handling SQS Message Failures](handling-sqs-failures.md).

### Host the same handlers on Lambda instead

Neither handler knows its host, so the exact same `PlaceOrderHandler` and `NotifyWarehouseHandler` run on
AWS Lambda — the HTTP one behind API Gateway, the queue one behind an SQS event-source mapping (using
`@benzene/aws-lambda-sqs`). See [AWS Lambda Setup](../getting-started-aws.md).

## Further Reading

- [Hosting](../hosting.md) — the Express host and the self-hosted worker execution models.
- [Clients](../clients.md) — `IBenzeneMessageSender`, outbound routing, and the SNS route extension.
- [SNS Fan-Out Pattern](sns-fan-out.md) — broadcasting one event to many independently-deployed consumers.
- [Handling SQS Message Failures](handling-sqs-failures.md) — partial batch failures and DLQs.
- [Idempotency](idempotency.md) — making the at-least-once worker safe to retry.
- [Getting Started](../getting-started.md) — the Express host walkthrough.

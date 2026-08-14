# Integration-Test Lambda Functions End-to-End Without Deploying

Build a full in-memory test suite for a multi-event-source Lambda function — API Gateway and SQS — from
the **same `BenzeneStartUp` you deploy**, so a passing suite means the real pipeline works.

## Problem Statement

You've written a Lambda function whose `BenzeneStartUp` handles both an API Gateway endpoint and an SQS
queue. Before deploying you want to:

- Exercise both event sources end to end (event → routing → handler → response) without deploying or
  running SAM local.
- Assert on the actual response API Gateway callers see (status code, body) and the actual SQS
  partial-batch-failure behavior.
- Assert on **side effects** — that a downstream port was called with the right arguments, or that a
  message was published — using fakes, no real infrastructure.
- Catch the wiring mistakes that build fine but throw the first time a message actually flows.

This builds on [Testing Benzene](../testing-benzene.md) (the reference for `benzeneTestHost`) and the
testing section of [Getting Started: AWS Lambda](../getting-started-aws.md). Both are accurate ground
truth for `benzeneTestHost(StartUp).buildAwsLambdaHost()`; this cookbook goes one level deeper with a
complete, realistic multi-handler suite, plus a troubleshooting section for mistakes that only show up at
runtime.

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and a Lambda function using `BenzeneStartUp` with at least one API
  Gateway and one SQS handler wired up — see [Getting Started: AWS Lambda](../getting-started-aws.md).
- [vitest](https://vitest.dev/) as the test runner (the port's counterpart to the .NET suite's xUnit;
  `vi.fn()` gives you spies).

## Installation

```bash
npm install --save-dev vitest @benzenejs/testing @benzenejs/aws-lambda-testing
```

`@benzenejs/testing` provides `benzeneTestHost`, `messageBuilder`/`httpBuilder`, and the
`FakeBenzeneMessageSender` egress double. `@benzenejs/aws-lambda-testing` adds the `buildAwsLambdaHost()`
specialization (imported for its side-effect module augmentation) and the native-event builders
`asApiGatewayRequest` / `asSqs`.

> **Consolidation note.** .NET ships a separate `*.TestHelpers` package per transport
> (`Benzene.Aws.Lambda.ApiGateway.TestHelpers`, `…Sqs.TestHelpers`, …). In Node every Lambda event type
> lives in the one `@types/aws-lambda` package, so there is nothing to isolate — the port ships a single
> `@benzenejs/aws-lambda-testing` with a builder per transport.

## The App Under Test

A small order-processing function: `POST /orders` charges a customer through a payment-gateway **port** and
returns the created order; an `orders:shipped` SQS message notifies the customer via a shipping-notifier
**port**. Both handlers depend on interfaces that are trivial to fake in tests.

```ts
// ports.ts
import { IBenzeneResultOf, ServiceToken, serviceToken } from '@benzenejs/abstractions';

export interface IPaymentGateway {
  chargeAsync(customerId: string, amountInCents: number): Promise<IBenzeneResultOf<string>>;
}
export const IPaymentGateway: ServiceToken<IPaymentGateway> =
  serviceToken<IPaymentGateway>('IPaymentGateway');

export interface IShippingNotifier {
  notifyCustomerAsync(orderId: string, trackingNumber: string): Promise<void>;
}
export const IShippingNotifier: ServiceToken<IShippingNotifier> =
  serviceToken<IShippingNotifier>('IShippingNotifier');
```

```ts
// handlers.ts
import { IBenzeneResultOf, VoidResult } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { message, MessageHandlersRegistry } from '@benzenejs/core-message-handlers';
import { httpEndpoint } from '@benzenejs/http';
import { BenzeneResult } from '@benzenejs/results';
import { IPaymentGateway, IShippingNotifier } from './ports.js';

// A local registry keeps importing this module out of the global handler discovery.
export const registry = new MessageHandlersRegistry();

export class CreateOrderRequest {
  customerId?: string;
  amountInCents?: number;
}
export class CreateOrderResponse {
  orderId?: string;
  chargeId?: string;
}
export class OrderShippedEvent {
  orderId?: string;
  trackingNumber?: string;
}

@httpEndpoint('POST', '/orders')
@message('orders:create', { registry, requestType: CreateOrderRequest, responseType: CreateOrderResponse })
export class CreateOrderHandler implements IMessageHandler<CreateOrderRequest, CreateOrderResponse> {
  static readonly inject = [IPaymentGateway] as const;
  constructor(private readonly payments: IPaymentGateway) {}

  async handleAsync(message: CreateOrderRequest): Promise<IBenzeneResultOf<CreateOrderResponse>> {
    const charge = await this.payments.chargeAsync(message.customerId!, message.amountInCents!);
    if (!charge.isSuccessful) {
      return BenzeneResult.badRequest<CreateOrderResponse>('Payment declined');
    }
    const response = new CreateOrderResponse();
    response.orderId = 'order-1';
    response.chargeId = charge.payload;
    return BenzeneResult.created(response);
  }
}

// No @httpEndpoint — this handler is only reachable over a topic (SQS here). It returns Void.
@message('orders:shipped', { registry, requestType: OrderShippedEvent, responseType: VoidResult })
export class OrderShippedHandler implements IMessageHandler<OrderShippedEvent, VoidResult> {
  static readonly inject = [IShippingNotifier] as const;
  constructor(private readonly notifier: IShippingNotifier) {}

  async handleAsync(message: OrderShippedEvent): Promise<IBenzeneResultOf<VoidResult>> {
    await this.notifier.notifyCustomerAsync(message.orderId!, message.trackingNumber!);
    return BenzeneResult.ok<VoidResult>();
  }
}
```

```ts
// StartUp.ts
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { useAwsLambda } from '@benzenejs/aws-lambda-core';
import { useApiGateway } from '@benzenejs/aws-lambda-api-gateway';
import { useSqs } from '@benzenejs/aws-lambda-sqs';
import { BenzeneStartUp } from '@benzenejs/testing';
import { CreateOrderHandler, OrderShippedHandler } from './handlers.js';
import { IPaymentGateway, IShippingNotifier } from './ports.js';
import { StripePaymentGateway, EmailShippingNotifier } from './adapters.js';

export class OrdersStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
    services.addScoped(IPaymentGateway, StripePaymentGateway);
    services.addScoped(IShippingNotifier, EmailShippingNotifier);
  }

  configure(app: IBenzeneApplicationBuilder): void {
    // One Lambda function, two event sources hanging off the same aws pipeline.
    useAwsLambda(app, (aws) => {
      useApiGateway(aws, (api) => useMessageHandlers(api, CreateOrderHandler));
      useSqs(aws, (sqs) => useMessageHandlers(sqs, OrderShippedHandler));
    });
  }
}
```

The production adapters aren't the point of this cookbook — the tests replace both with fakes — so they're
stubbed just enough to make the project complete:

```ts
// adapters.ts
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IPaymentGateway, IShippingNotifier } from './ports.js';

export class StripePaymentGateway implements IPaymentGateway {
  chargeAsync(): Promise<IBenzeneResultOf<string>> {
    throw new Error('calls the Stripe SDK in production');
  }
}
export class EmailShippingNotifier implements IShippingNotifier {
  notifyCustomerAsync(): Promise<void> {
    throw new Error('calls your email provider in production');
  }
}
```

## The Test Suite

`benzeneTestHost(OrdersStartUp)` boots the **real** startup; `.withServices(...)` overrides any
registration (last-registration-wins); `.buildAwsLambdaHost()` is the one AWS-specific line; and
`host.sendEventAsync(...)` pushes a native event through exactly the entry point AWS invokes:

```ts
// OrderFunction.test.ts
import { describe, expect, it, vi } from 'vitest';
import { APIGatewayProxyResult, SQSBatchResponse } from 'aws-lambda';
import { BenzeneResult } from '@benzenejs/results';
import { benzeneTestHost, httpBuilder, messageBuilder } from '@benzenejs/testing';
import { asApiGatewayRequest, asSqs } from '@benzenejs/aws-lambda-testing';
import { OrdersStartUp } from './StartUp.js';
import { IPaymentGateway, IShippingNotifier } from './ports.js';

describe('order function', () => {
  it('POST /orders → 201, charges the customer', async () => {
    const chargeAsync = vi.fn().mockResolvedValue(BenzeneResult.ok('charge-abc'));

    const host = benzeneTestHost(OrdersStartUp)
      .withServices((s) => s.addScopedInstance(IPaymentGateway, { chargeAsync }))
      .buildAwsLambdaHost();

    const request = asApiGatewayRequest(
      httpBuilder('POST', '/orders', { customerId: 'customer-1', amountInCents: 2500 }),
    );
    const response = await host.sendEventAsync<APIGatewayProxyResult>(request);

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body).chargeId).toBe('charge-abc');
    expect(chargeAsync).toHaveBeenCalledWith('customer-1', 2500);
  });

  it('POST /orders → 400 when the charge is declined', async () => {
    const chargeAsync = vi.fn().mockResolvedValue(BenzeneResult.badRequest<string>('card_declined'));

    const host = benzeneTestHost(OrdersStartUp)
      .withServices((s) => s.addScopedInstance(IPaymentGateway, { chargeAsync }))
      .buildAwsLambdaHost();

    const request = asApiGatewayRequest(
      httpBuilder('POST', '/orders', { customerId: 'customer-1', amountInCents: 2500 }),
    );
    const response = await host.sendEventAsync<APIGatewayProxyResult>(request);

    expect(response.statusCode).toBe(400);
  });

  it('orders:shipped SQS record → no batch failures, notifies the customer', async () => {
    const notifyCustomerAsync = vi.fn().mockResolvedValue(undefined);

    const host = benzeneTestHost(OrdersStartUp)
      .withServices((s) => s.addScopedInstance(IShippingNotifier, { notifyCustomerAsync }))
      .buildAwsLambdaHost();

    const event = asSqs(
      messageBuilder('orders:shipped', { orderId: 'o-1', trackingNumber: '1Z999AA10123456784' }),
    );
    const response = await host.sendEventAsync<SQSBatchResponse>(event);

    expect(response.batchItemFailures).toEqual([]);
    expect(notifyCustomerAsync).toHaveBeenCalledWith('o-1', '1Z999AA10123456784');
  });

  it('orders:shipped → reports a partial batch failure when the notifier throws', async () => {
    const notifyCustomerAsync = vi.fn().mockRejectedValue(new Error('email provider down'));

    const host = benzeneTestHost(OrdersStartUp)
      .withServices((s) => s.addScopedInstance(IShippingNotifier, { notifyCustomerAsync }))
      .buildAwsLambdaHost();

    const event = asSqs(messageBuilder('orders:shipped', { orderId: 'o-1', trackingNumber: '1Z' }));
    const response = await host.sendEventAsync<SQSBatchResponse>(event);

    // The failing record is reported so SQS retries/DLQs just that message — see handling-sqs-failures.md.
    expect(response.batchItemFailures).toHaveLength(1);
  });
});
```

A few things worth calling out:

- Each test builds its **own** host with its **own** fakes, so a spy in one test can't leak into another —
  the port's equivalent of a per-test `WithServices` factory.
- `response.body` on `APIGatewayProxyResult` is a plain JSON string; parse it with `JSON.parse` (or
  whatever your project already uses).
- The SQS tests assert on `response.batchItemFailures` — exactly the list the SQS handler reports back to
  the real Lambda service for partial-batch retry, so asserting on it is asserting on real AWS-facing
  behavior, not an implementation detail. See [Handling SQS Message Failures](handling-sqs-failures.md).
- Only line 3 (`.buildAwsLambdaHost()`) and the `as*` builder are AWS-specific: to test the same handlers on
  Azure, switch to `.buildAzureFunctionApp()` and `asAzure*` — everything else is identical. See
  [Testing Benzene → Azure Functions](../testing-benzene.md#azure-functions).

## Asserting on what was published (egress)

If a handler publishes a message rather than returning a payload, register the first-party
`FakeBenzeneMessageSender` for `IBenzeneMessageSender` and assert on what it captured — no live queue:

```ts
import { FakeBenzeneMessageSender } from '@benzenejs/testing';
import { IBenzeneMessageSender } from '@benzenejs/clients';

const fake = new FakeBenzeneMessageSender();

const host = benzeneTestHost(OrdersStartUp)
  .withServices((s) => s.addSingletonInstance(IBenzeneMessageSender, fake))
  .buildAwsLambdaHost();

await host.sendEventAsync(asApiGatewayRequest(httpBuilder('POST', '/orders/publish', order)));

expect(fake.lastTopic).toBe('order:created');
expect(fake.lastRequest).toMatchObject({ id: order.id });
```

The gold-standard worked exemplar for this ingress → handler → egress shape is
`test/Benzene.Core.Test/Testing/BenzeneTestHostTest.test.ts`.

## Troubleshooting

### `BenzeneException: … Unable to resolve … ISetCurrentTransport`

The most common first-run failure for a function that wires SQS/SNS/Kafka. Those transports resolve
`ISetCurrentTransport` while dispatching each record, and it's only registered by `addBenzene(services)`.
Make sure `configureServices` calls `addBenzene(services)` before anything else — `buildAwsLambdaHost()`
performs the exact same construction a real deployment does, so this surfaces identically in a test and in
production (catching it here is the point).

### `.withServices` fake never runs / the real dependency runs instead

`.withServices(...)` runs **after** `StartUp.configureServices`, and the container resolves the **last**
registration for an identifier — so the override only replaces a registration your startup actually made,
under the **same** token (`IPaymentGateway`, not a differently-named one). If `configureServices` doesn't
register the interface at all, there's nothing to override; register it in `StartUp` first.

### 404 / handler never invoked from `asApiGatewayRequest`

The `httpBuilder` method/path must match the handler's `@httpEndpoint('METHOD', '/path')` exactly, and the
handler must be passed to `useMessageHandlers(...)`. Note the port binds the JSON **body** onto the request
(see [Message Handlers](../message-handlers.md)) — send fields in the body, not as `/{id}` path segments.

### SQS test always reports a batch failure, even with a passing handler

`messageBuilder(topic, body)` must use the **exact** topic your `@message('...')` declares — `asSqs` puts it
in a `topic` message attribute and the router routes purely off that attribute, not the body. A topic typo
means no handler matches, which the pipeline reports as a failed record.

### Assertions on a spy fail even though the test "looks" right

`sendEventAsync(...)` is `async` — a missing `await` runs your assertions before the handler (and its fake)
have been invoked. Make the test `async` and `await host.sendEventAsync(...)`. This is a plain
`async`/`await` mistake, not a Benzene one, but an easy one to make.

## Variations

### A topic-routed test without a specific transport

To exercise a handler through the transport-neutral message pipeline (dispatch by topic, no cloud event),
use `asBenzeneMessage(messageBuilder(...))` against a `BenzeneMessageApplication` — see
[Payload Testing](../payload-testing.md) and [Testing Benzene](../testing-benzene.md#topic-centric-testing-the-benzenemessage-envelope).

### Layer configuration

`benzeneTestHost(...).withConfiguration(key, value)` (or an object) layers in-memory config over your
startup's own configuration (last-wins), handed to `configureServices`/`configure` — useful for pointing a
dependency at a locally running component. See [Testing Benzene → Notes](../testing-benzene.md#notes-and-limitations).

## Further Reading

- [Testing Benzene](../testing-benzene.md) — the full `benzeneTestHost` reference, Azure included, and the
  complete `as*` builder table.
- [Getting Started: AWS Lambda](../getting-started-aws.md) — the production wiring this suite boots from.
- [Handling SQS Message Failures](handling-sqs-failures.md) — the retry/DLQ behavior behind the
  `batchItemFailures` assertions.
- [Mocking External Dependencies](mocking-dependencies.md) — the low-level `Inline*StartUp` route when you
  want to bypass a startup class.
- [Payload Testing](../payload-testing.md) — firing a demo payload at a topic through the pipeline.

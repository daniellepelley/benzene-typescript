# Getting Started: Benzene on Azure Functions

Benzene runs on Azure Functions (the v4 isolated-worker programming model), hosting one set of message
handlers across multiple triggers — HTTP, Service Bus, and Event Hub — through a single middleware
pipeline. This guide starts from an empty folder and ends with a Function App serving HTTP requests,
then adds the async messaging triggers so you can see how one handler works across trigger types without
changing a line of it.

If you're brand new to Benzene, read [Getting Started](getting-started.md) first — it builds the same
kind of service locally on Express in about five minutes. The message handler you write there runs
unchanged on Azure Functions; only the entry point differs, and that's what this guide covers.

> **TypeScript port.** This is the TypeScript port of [Benzene](https://github.com/daniellepelley/benzene).
> It mirrors the .NET library's shape as closely as the language allows; where the two differ, the README's
> [Porting conventions](../README.md#porting-conventions) explain why. You write one `StartUp` class (the
> platform-neutral `BenzeneStartUp` contract) and boot it with the one-liner
> `new AzureFunctionHost(StartUp).httpFunction` — the exact Azure counterpart of AWS's
> `new AwsLambdaHost(StartUp).lambdaHandler`, and what the runnable
> [`examples/azure-functions`](../examples/azure-functions) uses. (The .NET isolated-worker `IHostBuilder`
> registration — `UseBenzene<TStartUp>` — has no direct port; `AzureFunctionHost` fills that role.)

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and npm
- Any editor
- The [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local)
  and an Azure subscription — only if you want to run or deploy a real Function App. Everything up to that
  point is ordinary TypeScript you can build locally.

## The core idea in 30 seconds

Benzene separates *what your service does* from *how it's invoked*:

- A **message handler** contains your logic. It receives a typed request, returns a typed
  [result](message-result.md), and knows nothing about Azure Functions, HTTP, or queues.
- Each handler is mapped to a **topic** — a stable string like `order:place` — via the `@message`
  decorator, and (for HTTP) to a method and path via `@httpEndpoint`.
- A **transport pipeline** turns an incoming trigger payload into a message, routes it to the matching
  handler by topic, and turns the result back into a trigger-native response.

On Azure Functions you build that pipeline once at module load, then export a small function callback per
trigger that dispatches the trigger's payload into it. The handler itself is identical to the one you'd
host on [Express](getting-started.md) or [AWS Lambda](getting-started-aws.md). See
[Message Handlers](message-handlers.md) and [Middleware](middleware.md) for the full picture.

## 1. Create the project

```bash
mkdir orders-functions && cd orders-functions
npm init -y
npm pkg set type=module
```

Setting `type=module` makes this an ES-module project, which Benzene's packages require — and it's the
shape the `@azure/functions` v4 model expects.

## 2. Install the packages

```bash
npm install @benzenejs/azure-function-core @benzenejs/azure-function-http \
  @benzenejs/azure-function-service-bus @benzenejs/azure-function-event-hub \
  @benzenejs/core-message-handlers @benzenejs/http @benzenejs/results \
  @benzenejs/abstractions @benzenejs/abstractions-message-handlers
npm install @azure/functions @azure/service-bus @azure/event-hubs
npm install --save-dev typescript
```

Each Azure trigger has its own transport package:

- `@benzenejs/azure-function-core` — the `AzureFunctionHost` that boots your `StartUp`, and the
  `useAzureFunctions` selector you wire triggers on inside `configure`.
- `@benzenejs/azure-function-http` — the HTTP transport (`useAzureHttp`) and its `handleHttpRequest`
  dispatch helper.
- `@benzenejs/azure-function-service-bus` — the Service Bus transport (`useServiceBus`) and
  `handleServiceBusMessages`.
- `@benzenejs/azure-function-event-hub` — the Event Hub transport (`useEventHub` / `useBenzeneMessage`) and
  `handleEventHub`.

`@benzenejs/core-message-handlers` brings the message-handler infrastructure (`addBenzene`,
`useMessageHandlers`, the `@message` decorator); `@benzenejs/http` adds the `httpEndpoint` helper;
`@benzenejs/results` provides `BenzeneResult`. The `@azure/*` packages are the trigger runtime and its
message types.

## 3. Write a message handler

Create `src/handlers.ts`. This is where your logic lives — the file you'd carry over verbatim if you
later moved to Express or AWS Lambda:

```ts
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { message } from '@benzenejs/core-message-handlers';
import { httpEndpoint } from '@benzenejs/http';
import { BenzeneResult } from '@benzenejs/results';

// Payloads are classes, not interfaces: the runtime recovers the erased request type from its
// constructor (for topic/schema keying), which an interface can't provide.
export class PlaceOrder {
  customerId?: string;
}

export class OrderConfirmation {
  orderId?: string;
}

@httpEndpoint('POST', '/orders')
@message('order:place', { requestType: PlaceOrder, responseType: OrderConfirmation })
export class PlaceOrderHandler implements IMessageHandler<PlaceOrder, OrderConfirmation> {
  handleAsync(request: PlaceOrder): Promise<IBenzeneResultOf<OrderConfirmation>> {
    const confirmation = new OrderConfirmation();
    confirmation.orderId = `order-${request.customerId ?? 'anon'}`;
    return Promise.resolve(BenzeneResult.created(confirmation));
  }
}
```

Two decorators do the wiring:

- `@message('order:place', …)` maps the handler to its topic. Every Benzene transport routes by topic,
  so this identifier stays constant across HTTP, Service Bus, and Event Hub. The
  `requestType`/`responseType` give the runtime the concrete classes it needs (TypeScript erases
  generics, so they can't be inferred).
- `@httpEndpoint('POST', '/orders')` maps an HTTP method and path onto that same topic, so the same
  handler answers both an HTTP request and a direct topic-routed message from a messaging trigger.

`BenzeneResult.created(...)` is the success case that maps to HTTP `201`; use `BenzeneResult.ok(...)` for
`200`. The result carries success/failure status alongside the payload — see
[Message Result](message-result.md).

> **Request binding.** Benzene binds the JSON **request body** onto your request object, so a `POST`
> with `{"customerId":"acme"}` populates `request.customerId`. Unlike .NET, the TypeScript port does
> **not** bind path/query segments onto a bodyless request, so this guide uses a `POST` body rather than
> a `GET /hello/{name}`. Read values a client sends in the body.

## 4. Write the composition root (`StartUp`)

Create `src/startUp.ts` — the single place your service is wired. It implements the platform-neutral
`BenzeneStartUp` contract (the *same* shape on every cloud): `configureServices` registers the service
graph, and `configure` wires the transport pipeline on the unified `IBenzeneApplicationBuilder`, selecting
Azure inside it with `useAzureFunctions(app, az => …)`:

```ts
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneConfiguration, BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { useAzureFunctions } from '@benzenejs/azure-function-core';
import { useAzureHttp } from '@benzenejs/azure-function-http';
import { PlaceOrderHandler } from './handlers';

export class HttpStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    // Register your application services here. `addBenzene` pulls in the serializer and message-handler
    // infrastructure every transport needs.
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useAzureFunctions(app, (az) => useAzureHttp(az, (http) => useMessageHandlers(http, PlaceOrderHandler)));
  }
}
```

- `useAzureFunctions(app, az => …)` is the Azure counterpart of AWS's `useAwsLambda(app, aws => …)`: it
  hands you the Azure trigger builder and no-ops on any other platform, so the SAME `StartUp` is portable.
- Inside it, `useAzureHttp(az, http => …)` inserts the HTTP transport and `useMessageHandlers(http, …)`
  routes a matched request to its handler. Pass every handler class you want served.

> **One StartUp (and host) per trigger.** Under TypeScript's type erasure two transports can't share one
> container, so each trigger gets its own `StartUp` and its own `AzureFunctionHost` — exactly what the
> steps below do. This mirrors the per-function Lambda default described in the README.

## 5. Boot the host

Create `src/functions.ts`. This is the only file that knows it's running on Azure Functions: it boots one
`AzureFunctionHost` per trigger (once, at module load) and exports the native-trigger handler the runtime
registers. For HTTP that's `.httpFunction`; importing `@benzenejs/azure-function-http` lights the getter up
(the same import your `StartUp` already needs for `useAzureHttp`):

```ts
import { AzureFunctionHost } from '@benzenejs/azure-function-core';
import '@benzenejs/azure-function-http';
import { HttpStartUp } from './startUp';

/** HTTP trigger (request/response): `POST /orders` returns an order confirmation. */
export const placeOrderHttp = new AzureFunctionHost(HttpStartUp).httpFunction;
```

`new AzureFunctionHost(HttpStartUp).httpFunction` is the one-liner boot — the Azure counterpart of AWS's
`new AwsLambdaHost(StartUp).lambdaHandler`. It boots the SAME `HttpStartUp` a component test boots, so
what you test is what deploys. (Prefer a free function over the getter? The host also exposes its built
app: `handleHttpRequest(host.app, request)` does the same thing.)

## 6. Register with the Functions host

The `@azure/functions` v4 runtime discovers your triggers from `app.*` registrations. Create
`src/registrations.ts` — the module the Functions host loads, which binds each callback to a real
trigger:

```ts
import { app } from '@azure/functions';
import { placeOrderHttp } from './functions';

// The getter is already an `@azure/functions` HTTP handler, so it drops straight into `handler`.
app.http('placeOrder', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'orders',
  handler: placeOrderHttp,
});
```

`app.http(...)` registers with the `@azure/functions` runtime on import, so this module is loaded by the
host — not by your other code. Keeping it separate from `functions.ts` means the trigger getters stay plain
exports while this file owns the runtime bindings.

## 7. Add the messaging triggers

The whole point of Benzene is that a handler doesn't care which trigger delivered its message. Add an
event consumer that reacts to placed orders — the same shape, a different topic:

```ts
// add to src/handlers.ts
export class OrderPlaced {
  orderId?: string;
}

export class WarehouseAck {
  accepted?: boolean;
}

@message('order:placed', { requestType: OrderPlaced, responseType: WarehouseAck })
export class NotifyWarehouseHandler implements IMessageHandler<OrderPlaced, WarehouseAck> {
  handleAsync(request: OrderPlaced): Promise<IBenzeneResultOf<WarehouseAck>> {
    // ... notify the warehouse
    const ack = new WarehouseAck();
    ack.accepted = true;
    return Promise.resolve(BenzeneResult.ok(ack));
  }
}
```

`NotifyWarehouseHandler` has no `@httpEndpoint` — it's reached only by its topic, `order:placed`, over
whichever messaging trigger delivers it. Add a `StartUp` per messaging trigger to `src/startUp.ts` (each
the same shape as `HttpStartUp`, only the transport verb differs):

```ts
// add to src/startUp.ts
import { useServiceBus } from '@benzenejs/azure-function-service-bus';
import { useBenzeneMessage, useEventHub } from '@benzenejs/azure-function-event-hub';
import { NotifyWarehouseHandler } from './handlers';

/** Service Bus trigger (batched): each message routes by its `topic` application property. */
export class ServiceBusStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    addBenzene(services);
  }
  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useAzureFunctions(app, (az) => useServiceBus(az, (sb) => useMessageHandlers(sb, NotifyWarehouseHandler)));
  }
}

/** Event Hub trigger (batched): each event carries a serialized BenzeneMessage envelope; route on its topic. */
export class EventHubStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    addBenzene(services);
  }
  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useAzureFunctions(app, (az) =>
      useEventHub(az, (eh) => useBenzeneMessage(eh, (msg) => useMessageHandlers(msg, NotifyWarehouseHandler))),
    );
  }
}
```

Then boot each in `src/functions.ts` — one `AzureFunctionHost` per trigger, exposing that trigger's
native getter:

```ts
import '@benzenejs/azure-function-service-bus';
import '@benzenejs/azure-function-event-hub';
import { EventHubStartUp, ServiceBusStartUp } from './startUp';

/** Service Bus trigger (batched): each message routes by its `topic` application property. */
export const orderPlacedServiceBus = new AzureFunctionHost(ServiceBusStartUp).serviceBusFunction;

/** Event Hub trigger (batched): each event routes by its embedded topic. */
export const orderPlacedEventHub = new AzureFunctionHost(EventHubStartUp).eventHubFunction;
```

Two things to note:

- **Service Bus** resolves the topic from each message's `topic` application property, then routes it to
  the matching handler. `.serviceBusFunction` accepts a single message or a batch.
- **Event Hub** is shaped differently: events carry a serialized `BenzeneMessage` envelope, so you wrap
  the inner handlers in `useBenzeneMessage`, which deserializes each event and routes on the envelope's
  own topic. `.eventHubFunction` likewise takes a batch.

Then bind both to real triggers in `src/registrations.ts`:

```ts
import { app, InvocationContext } from '@azure/functions';
import type { ServiceBusReceivedMessage } from '@azure/service-bus';
import type { ReceivedEventData } from '@azure/event-hubs';
import { orderPlacedEventHub, orderPlacedServiceBus, placeOrderHttp } from './functions';

// app.http('placeOrder', { ... }) as in step 6

app.serviceBusQueue('orderPlacedServiceBus', {
  connection: 'ServiceBusConnection',
  queueName: 'orders',
  cardinality: 'many', // batched: the handler receives an array of messages
  handler: (messages: unknown, _context: InvocationContext) =>
    orderPlacedServiceBus(messages as ServiceBusReceivedMessage[]),
});

app.eventHub('orderPlacedEventHub', {
  connection: 'EventHubConnection',
  eventHubName: 'orders',
  cardinality: 'many',
  handler: (events: unknown, _context: InvocationContext) =>
    orderPlacedEventHub(events as ReceivedEventData[]),
});
```

`connection` names an app setting holding the Service Bus / Event Hubs connection string (or the
identity-based settings). Adding a trigger is a wiring change, not a rewrite — the handlers in
`handlers.ts` never changed.

## Supported triggers

Each trigger is a transport package with a `use…` function you call inside `configure`, plus the
`AzureFunctionHost` getter your `registrations.ts` binds to a real trigger.

| Azure trigger | Transport function | Host getter | Package |
|---|---|---|---|
| HTTP | `useAzureHttp` | `.httpFunction` | `@benzenejs/azure-function-http` |
| Service Bus | `useServiceBus` | `.serviceBusFunction` | `@benzenejs/azure-function-service-bus` |
| Event Hub | `useEventHub` / `useBenzeneMessage` | `.eventHubFunction` | `@benzenejs/azure-function-event-hub` |

The [`examples/azure-functions`](../examples/azure-functions) project hosts one order domain on all three
triggers — the handlers identical in shape to the AWS Lambda example's, proving the same handler runs on
both clouds unchanged.

## Configuration

`AzureFunctionHost` builds the pipeline once, on cold start. Register your own services inside your
`StartUp`'s `configureServices`; the natural source of configuration in a Function App is its application
settings via `process.env`:

```ts
export class HttpStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    addBenzene(services);
    services.addSingletonInstance(OrdersConfig, { queueName: process.env.ORDERS_QUEUE ?? 'orders' });
  }
  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useAzureFunctions(app, (az) => useAzureHttp(az, (http) => useMessageHandlers(http, PlaceOrderHandler)));
  }
}
```

> `BenzeneConfiguration` is a small key/value lookup (`config.get('ORDERS_QUEUE')`); a component test layers
> overrides on top with `.withConfiguration(...)`. The full .NET `IConfiguration` provider model is not
> ported — read `process.env` (or your own loader) directly for now.

## Troubleshooting

**Handler never called / 404 from the HTTP trigger.** Check that `@httpEndpoint('METHOD', '/path')`
matches the request exactly (method and route), that the `app.http(...)` `route` matches the endpoint
path, and that the handler class was passed to `useMessageHandlers(...)`.

**Service Bus message never routes to a handler.** The Service Bus transport resolves the topic from the
message's `topic` application property, not the body. Confirm the producer sets it, and that a handler
exists with a matching `@message('...')` topic.

**Event Hub event never routes to a handler.** Event Hub expects a serialized `BenzeneMessage` envelope
and routes on the envelope's topic. Make sure the producer sends a Benzene message and that the inner
handlers are wrapped in `useBenzeneMessage`.

**Two transports collide in one entry point.** Under type erasure two transports can't share a single
container. Give each trigger its own `StartUp` and its own `AzureFunctionHost` (as the steps above do)
rather than adding two `use…` transports to one `configure`.

## See Also

- [Getting Started](getting-started.md) — build the same handler locally on Express first
- [AWS Lambda Setup](getting-started-aws.md) — the same handlers, hosted on AWS
- [Message Handlers](message-handlers.md) — the handler contract, topics, and `@message`/`@httpEndpoint`
- [Message Result](message-result.md) — `BenzeneResult.ok`/`.created` and the result envelope
- [Middleware](middleware.md) and [Common Middleware](common-middleware.md) — what else composes into the pipeline
- [Testing Benzene](testing-benzene.md) — testing handlers and pipelines end-to-end
- [`examples/azure-functions`](../examples/azure-functions) — one domain on three Azure triggers

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
> [Porting conventions](../README.md#porting-conventions) explain why. The .NET **isolated-worker host
> bootstrap** (`UseBenzene<TStartUp>` on `IHostBuilder`, and the `IFunctionsWorkerApplicationBuilder`
> middleware) has no port yet — for wiring the port uses the fluent `InlineAzureFunctionStartUp` builder
> throughout, which is exactly what the runnable [`examples/azure-functions`](../examples/azure-functions)
> uses.

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
npm install @benzene/azure-function-core @benzene/azure-function-http \
  @benzene/azure-function-service-bus @benzene/azure-function-event-hub \
  @benzene/core-message-handlers @benzene/http @benzene/results \
  @benzene/abstractions @benzene/abstractions-message-handlers
npm install @azure/functions @azure/service-bus @azure/event-hubs
npm install --save-dev typescript
```

Each Azure trigger has its own transport package:

- `@benzene/azure-function-core` — the `InlineAzureFunctionStartUp` builder and the `IAzureFunctionApp`
  it produces.
- `@benzene/azure-function-http` — the HTTP transport (`useAzureHttp`) and its `handleHttpRequest`
  dispatch helper.
- `@benzene/azure-function-service-bus` — the Service Bus transport (`useServiceBus`) and
  `handleServiceBusMessages`.
- `@benzene/azure-function-event-hub` — the Event Hub transport (`useEventHub` / `useBenzeneMessage`) and
  `handleEventHub`.

`@benzene/core-message-handlers` brings the message-handler infrastructure (`addBenzene`,
`useMessageHandlers`, the `@message` decorator); `@benzene/http` adds the `httpEndpoint` helper;
`@benzene/results` provides `BenzeneResult`. The `@azure/*` packages are the trigger runtime and its
message types.

## 3. Write a message handler

Create `src/handlers.ts`. This is where your logic lives — the file you'd carry over verbatim if you
later moved to Express or AWS Lambda:

```ts
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { BenzeneResult } from '@benzene/results';

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

## 4. Build the Azure app

Create `src/azureApp.ts` — a tiny shared builder that wires Benzene onto the container and hands the
builder to a per-trigger `configure` callback, returning the built `IAzureFunctionApp` your callbacks
dispatch to:

```ts
import { addBenzene } from '@benzene/core-message-handlers';
import {
  IAzureFunctionApp,
  IAzureFunctionAppBuilder,
  InlineAzureFunctionStartUp,
} from '@benzene/azure-function-core';

export function azureApp(configure: (app: IAzureFunctionAppBuilder) => void): IAzureFunctionApp {
  return new InlineAzureFunctionStartUp()
    .configureServices((services) => addBenzene(services))
    .configure(configure)
    .build();
}
```

- `new InlineAzureFunctionStartUp()` is the fluent entry-point builder.
- `configureServices((services) => addBenzene(services))` registers the baseline Benzene services once;
  `addBenzene` pulls in the serializer and message-handler infrastructure every transport needs.
- `configure(...)` receives the `IAzureFunctionAppBuilder` and is where each trigger's transport is
  added.
- `build()` constructs the pipeline and returns an `IAzureFunctionApp` — a pure dispatcher the transport
  `handle*` helpers hand payloads to.

## 5. Wire the trigger callbacks

Create `src/functions.ts`. This is the only file that knows it's running on Azure Functions: it builds a
Benzene app per trigger (once, at module load) and exports one callback per trigger that dispatches into
it via the transport's `handle*` helper. Start with HTTP:

```ts
import { HttpRequest, HttpResponseInit } from '@azure/functions';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { handleHttpRequest, useAzureHttp } from '@benzene/azure-function-http';
import { azureApp } from './azureApp';
import { PlaceOrderHandler } from './handlers';

const httpApp = azureApp((app) => useAzureHttp(app, (http) => useMessageHandlers(http, PlaceOrderHandler)));

/** HTTP trigger (request/response): `POST /orders` returns an order confirmation. */
export function placeOrderHttp(request: HttpRequest): Promise<HttpResponseInit> {
  return handleHttpRequest(httpApp, request);
}
```

- `useAzureHttp(app, (http) => …)` inserts the HTTP transport, and inside it
  `useMessageHandlers(http, PlaceOrderHandler)` routes a matched request to its handler. Pass every
  handler class you want served.
- `handleHttpRequest(httpApp, request)` reads the request body (it's asynchronous, and can only be read
  once) and dispatches through the pipeline, returning the `HttpResponseInit` Azure Functions sends back.

## 6. Register with the Functions host

The `@azure/functions` v4 runtime discovers your triggers from `app.*` registrations. Create
`src/registrations.ts` — the module the Functions host loads, which binds each callback to a real
trigger:

```ts
import { app } from '@azure/functions';
import { placeOrderHttp } from './functions';

app.http('placeOrder', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'orders',
  handler: (request) => placeOrderHttp(request),
});
```

`app.http(...)` registers with the `@azure/functions` runtime on import, so this module is loaded by the
host — not by your other code. Keeping it separate from `functions.ts` means the callbacks stay plain,
directly-callable functions while this file owns the trigger bindings.

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
whichever messaging trigger delivers it. Build an app per messaging trigger in `src/functions.ts`:

```ts
import type { ServiceBusReceivedMessage } from '@azure/service-bus';
import type { ReceivedEventData } from '@azure/event-hubs';
import { handleServiceBusMessages, useServiceBus } from '@benzene/azure-function-service-bus';
import { handleEventHub, useBenzeneMessage, useEventHub } from '@benzene/azure-function-event-hub';
import { NotifyWarehouseHandler } from './handlers';

const serviceBusApp = azureApp((app) =>
  useServiceBus(app, (sb) => useMessageHandlers(sb, NotifyWarehouseHandler)),
);

// Event Hub events carry a serialized BenzeneMessage envelope, so the inner pipeline routes on the
// envelope's own topic via `useBenzeneMessage`.
const eventHubApp = azureApp((app) =>
  useEventHub(app, (eh) => useBenzeneMessage(eh, (msg) => useMessageHandlers(msg, NotifyWarehouseHandler))),
);

/** Service Bus trigger (batched): each message routes by its `topic` application property. */
export function orderPlacedServiceBus(messages: ServiceBusReceivedMessage[]): Promise<void> {
  return handleServiceBusMessages(serviceBusApp, ...messages);
}

/** Event Hub trigger (batched): each event routes by its embedded topic. */
export function orderPlacedEventHub(events: ReceivedEventData[]): Promise<void> {
  return handleEventHub(eventHubApp, ...events);
}
```

Two things to note:

- **Service Bus** resolves the topic from each message's `topic` application property, then routes it to
  the matching handler. `handleServiceBusMessages` takes a rest parameter, so it works for a single
  message or a batch.
- **Event Hub** is shaped differently: events carry a serialized `BenzeneMessage` envelope, so you wrap
  the inner handlers in `useBenzeneMessage`, which deserializes each event and routes on the envelope's
  own topic. `handleEventHub` likewise takes a batch.

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

Each trigger is a transport package with a `use…` function you call inside `configure`, plus a `handle…`
helper your callback dispatches through.

| Azure trigger | Transport function | Dispatch helper | Package |
|---|---|---|---|
| HTTP | `useAzureHttp` | `handleHttpRequest` | `@benzene/azure-function-http` |
| Service Bus | `useServiceBus` | `handleServiceBusMessages` | `@benzene/azure-function-service-bus` |
| Event Hub | `useEventHub` / `useBenzeneMessage` | `handleEventHub` | `@benzene/azure-function-event-hub` |

The [`examples/azure-functions`](../examples/azure-functions) project hosts one order domain on all three
triggers — the handlers identical in shape to the AWS Lambda example's, proving the same handler runs on
both clouds unchanged.

## Configuration

`InlineAzureFunctionStartUp` builds the pipeline once, at module load. Register your own services inside
`configureServices`; the natural source of configuration in a Function App is its application settings via
`process.env`:

```ts
new InlineAzureFunctionStartUp()
  .configureServices((services) => {
    addBenzene(services);
    services.addSingletonInstance(OrdersConfig, { queueName: process.env.ORDERS_QUEUE ?? 'orders' });
  })
  .configure((app) => useAzureHttp(app, (http) => useMessageHandlers(http, PlaceOrderHandler)))
  .build();
```

> The .NET host's `IConfiguration` abstraction has no port yet — read `process.env` (or your own loader)
> directly for now.

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
container. Build one `IAzureFunctionApp` per trigger (as the `azureApp(...)` helper does for each
callback) rather than adding two `use…` transports to one `configure`.

## See Also

- [Getting Started](getting-started.md) — build the same handler locally on Express first
- [AWS Lambda Setup](getting-started-aws.md) — the same handlers, hosted on AWS
- [Message Handlers](message-handlers.md) — the handler contract, topics, and `@message`/`@httpEndpoint`
- [Message Result](message-result.md) — `BenzeneResult.ok`/`.created` and the result envelope
- [Middleware](middleware.md) and [Common Middleware](common-middleware.md) — what else composes into the pipeline
- [Testing Benzene](testing-benzene.md) — testing handlers and pipelines end-to-end
- [`examples/azure-functions`](../examples/azure-functions) — one domain on three Azure triggers

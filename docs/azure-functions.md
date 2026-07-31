# Azure Functions Setup

This guide takes the same message handler you'd write for any Benzene host and runs it on
[Azure Functions](https://learn.microsoft.com/azure/azure-functions/), using the
[`@azure/functions` v4 Node programming model](https://learn.microsoft.com/azure/azure-functions/functions-reference-node?pivots=nodejs-model-v4).
It starts from an empty folder and ends with a Function App handling HTTP requests, plus optional
non-HTTP triggers — Service Bus, Event Hub, and Kafka.

If you're new to Benzene, read [Getting Started](getting-started.md) first — it builds the same kind of
handler locally on Express in about five minutes. The handler you write there runs here unchanged; only
the transport wiring differs.

> **TypeScript port.** This is the TypeScript port of [Benzene](https://github.com/daniellepelley/benzene-dotnet).
> The .NET original hosts Azure Functions on the isolated-worker model and uses a source generator to
> emit the trigger classes. The Node v4 programming model already registers triggers with a plain
> function call (`app.http(...)`, `app.serviceBusQueue(...)`, …), so the port leans on that native API
> instead of a generator — you write the registration, Benzene handles the dispatch. See the README's
> [Porting conventions](../README.md#porting-conventions) for how the rest maps across.

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and npm
- [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local)
  (`func`) to run and deploy locally
- An Azure subscription with the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli),
  if you want to deploy

## 1. Create the project

```bash
mkdir my-function && cd my-function
npm init -y
npm pkg set type=module
```

`type=module` makes this an ES-module project, which Benzene's packages require.

## 2. Install the packages

```bash
npm install @benzene/azure-function-core @benzene/azure-function-http \
  @benzene/core-message-handlers @benzene/http @benzene/results \
  @benzene/abstractions @benzene/abstractions-message-handlers @azure/functions
npm install --save-dev typescript
```

`@benzene/azure-function-core` supplies the app builder (`InlineAzureFunctionStartUp`) and the built
`IAzureFunctionApp` your trigger callbacks dispatch to. `@benzene/azure-function-http` adds the HTTP
pipeline (`useAzureHttp`) and the `handleHttpRequest` dispatch helper, retargeted onto the
`@azure/functions` v4 HTTP model (`HttpRequest` / `HttpResponseInit`). The `@benzene/*` abstraction
packages supply the types your handler references. Add `@benzene/azure-function-service-bus`,
`@benzene/azure-function-event-hub`, or `@benzene/azure-function-kafka` — plus their `@azure/*` SDK peers
— if your function also handles those event sources (see [Non-HTTP triggers](#non-http-triggers)).

## 3. Write a message handler

Business logic lives in a message handler, not in the trigger callback — that's what keeps it testable
and portable across hosts. This is the one file you'd carry over verbatim from an Express or AWS Lambda
service. Create `src/handlers.ts`:

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

Two decorators do the wiring: `@message('order:place', …)` maps the handler to its topic and
self-registers it when the module loads; `@httpEndpoint('POST', '/orders')` maps an HTTP method and
path onto that same topic. See [Message Handlers](message-handlers.md) for the full picture.

> **Request binding.** Benzene binds the JSON **request body** onto your request object, so `POST /orders`
> with `{"customerId":"acme"}` populates `request.customerId`. Unlike .NET, the TypeScript port does not
> bind path/query segments onto a bodyless request — read values a client sends in the body. See the
> note in [Getting Started](getting-started.md) for the reasoning.

## 4. Build the Benzene app

`InlineAzureFunctionStartUp` (from `@benzene/azure-function-core`) is the fluent app builder — the TS
port of the .NET `BenzeneStartUp`. You register services, configure the transport pipeline, and `build()`
returns an `IAzureFunctionApp` that dispatches an incoming request to the matching handler. Create
`src/azureApp.ts` with a small helper so every trigger shares one setup:

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

`addBenzene(services)` registers Benzene's core middleware and message-handler infrastructure on the
port's first-party DI container (Node has no `Microsoft.Extensions.DependencyInjection`, so
`@benzene/dependencies` ships an equivalent — see the README).

> **One app per trigger.** Each `azureApp(...)` builds its own container and pipeline. Under TypeScript's
> type erasure two transports can't share a single container (their message getters register under the
> same erased token and would overwrite each other), so build one app per trigger — exactly what the
> steps below do. This mirrors the per-function Lambda default described in the README.

## 5. Wire the trigger callbacks

Now dispatch each trigger's payload into a Benzene app via the transport's `handle*` helper. For HTTP,
`useAzureHttp` configures the pipeline and `handleHttpRequest` reads the request body and returns the
`HttpResponseInit`. Create `src/functions.ts`:

```ts
import { HttpRequest, HttpResponseInit } from '@azure/functions';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { handleHttpRequest, useAzureHttp } from '@benzene/azure-function-http';
import { azureApp } from './azureApp.js';
import { PlaceOrderHandler } from './handlers.js';

const httpApp = azureApp((app) =>
  useAzureHttp(app, (http) => useMessageHandlers(http, PlaceOrderHandler)),
);

/** HTTP trigger (request/response): `POST /orders` returns an order confirmation. */
export function placeOrderHttp(request: HttpRequest): Promise<HttpResponseInit> {
  return handleHttpRequest(httpApp, request);
}
```

`useMessageHandlers(http, PlaceOrderHandler)` is the step that routes a matched request to its handler —
pass every handler class you want served. It's a free function taking the pipeline builder first (the
port's shape for fluent extensions defined downstream of the builder — see the README), so it reads as
`useAzureHttp(app, (http) => useMessageHandlers(http, …))`.

## 6. Register the trigger with the Functions host

The `@azure/functions` v4 model registers triggers by calling `app.http(...)` at module load. This is
where you own every binding value — method, route, auth level. Create `src/registrations.ts`:

```ts
import { app } from '@azure/functions';
import { placeOrderHttp } from './functions.js';

app.http('placeOrder', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'orders',
  handler: (request) => placeOrderHttp(request),
});
```

Then point the Function App at the compiled output. The Node runtime executes the file(s) named by
`main` in `package.json`, and needs a `host.json`:

`package.json` (add these):

```json
{
  "main": "dist/registrations.js",
  "scripts": {
    "build": "tsc",
    "start": "npm run build && func start"
  }
}
```

`host.json`:

```json
{
  "version": "2.0",
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle",
    "version": "[4.*, 5.0.0)"
  }
}
```

The extension bundle supplies the trigger bindings the host needs (HTTP, Service Bus, Event Hub, …), so
you don't install them per-trigger the way the .NET isolated worker references
`Microsoft.Azure.Functions.Worker.Extensions.*` packages. Add a minimal `tsconfig.json` that emits to
`dist/` (`"outDir": "dist"`, `"module": "NodeNext"`, `"target": "ES2022"`).

## 7. Configure local settings

Add `local.settings.json` — machine-local and secret-holding, so keep it out of source control:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "",
    "FUNCTIONS_WORKER_RUNTIME": "node"
  }
}
```

Application settings and environment variables both surface as `process.env` at runtime, so read
configuration from there in `configureServices`.

## 8. Run it locally

```bash
npm run build
func start
```

`POST` to `http://localhost:7071/api/orders` to confirm the handler responds (the `api` prefix is the
Azure Functions default route prefix — clear it with `"routePrefix": ""` under `extensions.http` in
`host.json` if you'd rather not have it):

```bash
curl -X POST http://localhost:7071/api/orders -H 'content-type: application/json' -d '{"customerId":"acme"}'
```

```json
{"orderId":"order-acme"}
```

The request arrived over HTTP, Benzene mapped `POST /orders` to the `order:place` topic, bound the JSON
body onto `PlaceOrder`, invoked your handler, and serialised `BenzeneResult.created(...)` back as a 201.

## 9. Deploy

Create the Function App resource (a Consumption-plan example; adjust SKU/plan for your needs):

```bash
az group create --name my-function-rg --location eastus
az storage account create --name mystorageacct --location eastus --resource-group my-function-rg --sku Standard_LRS
az functionapp create --resource-group my-function-rg --consumption-plan-location eastus \
  --runtime node --runtime-version 22 --functions-version 4 --name my-function-app --storage-account mystorageacct
```

Build and publish:

```bash
npm run build
func azure functionapp publish my-function-app
```

Once deployed, `POST` the printed URL at `/api/orders` (or `/orders`, depending on your `routePrefix`
setting) to confirm the handler responds.

## Non-HTTP triggers

Benzene provides matching pipelines for other Azure Functions trigger types. Each follows the same
two-part shape as HTTP: **build an app** with the transport's `use*` pipeline (in its own
`azureApp(...)`), and **register the trigger** with the `@azure/functions` v4 API, its callback
forwarding the payload into the app via the transport's `handle*` helper.

The runnable [`examples/azure-functions`](../examples/azure-functions) project wires exactly this — one
order domain on HTTP, Service Bus, and Event Hub, with the same handlers on every trigger.

### Service Bus

```bash
npm install @benzene/azure-function-service-bus @azure/service-bus
```

Service Bus messages carry real key/value application properties, so Benzene dispatches by topic
directly — set a `"topic"` application property on each message you send, and
`ServiceBusMessageTopicGetter` reads it to route to the matching `@message` handler:

```ts
import type { ServiceBusReceivedMessage } from '@azure/service-bus';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { handleServiceBusMessages, useServiceBus } from '@benzene/azure-function-service-bus';
import { azureApp } from './azureApp.js';
import { NotifyWarehouseHandler } from './handlers.js';

const serviceBusApp = azureApp((app) =>
  useServiceBus(app, (sb) => useMessageHandlers(sb, NotifyWarehouseHandler)),
);

/** Service Bus trigger (batched): each message routes by its `topic` application property. */
export function orderPlacedServiceBus(messages: ServiceBusReceivedMessage[]): Promise<void> {
  return handleServiceBusMessages(serviceBusApp, ...messages);
}
```

`handleServiceBusMessages` takes a rest parameter (spread the batch into it), so it serves both a
single-message trigger and a batched one. Register it:

```ts
import { app, InvocationContext } from '@azure/functions';
import type { ServiceBusReceivedMessage } from '@azure/service-bus';
import { orderPlacedServiceBus } from './functions.js';

app.serviceBusQueue('orderPlacedServiceBus', {
  connection: 'ServiceBusConnection',
  queueName: 'orders',
  cardinality: 'many', // batched: the handler receives an array of messages
  handler: (messages: unknown, _context: InvocationContext) =>
    orderPlacedServiceBus(messages as ServiceBusReceivedMessage[]),
});
```

If a queue's producer isn't a Benzene client and never sets the `"topic"` property, give that pipeline a
fixed topic instead with `usePresetTopic` (from `@benzene/core-message-handlers`), so every message on it
routes to one handler — `useServiceBus(app, (sb) => useMessageHandlers(usePresetTopic(sb, 'order:placed'), NotifyWarehouseHandler))`.
See [Common Middleware](common-middleware.md) for `usePresetTopic`.

`useServiceBus` accepts an optional third argument to configure `ServiceBusOptions` — `catchExceptions`
(catch a handler exception so one message's failure doesn't fail the whole batch) and
`raiseOnFailureStatus` (escalate a non-exception failure result into a thrown error so the host's retry
policy notices). Both default to `false`.

### Event Hub

```bash
npm install @benzene/azure-function-event-hub @azure/event-hubs
```

Event Hub events carry no routable topic of their own, so Benzene reads a **message envelope** from each
event body — the small JSON wrapper `{ "topic": …, "headers": …, "body": … }` any producer can send (the
same envelope shape used for AWS SQS/SNS). `useBenzeneMessage` bridges into a direct-message pipeline that
routes on the envelope's own topic:

```ts
import type { ReceivedEventData } from '@azure/event-hubs';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { handleEventHub, useBenzeneMessage, useEventHub } from '@benzene/azure-function-event-hub';
import { azureApp } from './azureApp.js';
import { NotifyWarehouseHandler } from './handlers.js';

const eventHubApp = azureApp((app) =>
  useEventHub(app, (eh) =>
    useBenzeneMessage(eh, (msg) => useMessageHandlers(msg, NotifyWarehouseHandler)),
  ),
);

/** Event Hub trigger (batched): each event routes by its embedded envelope topic. */
export function orderPlacedEventHub(events: ReceivedEventData[]): Promise<void> {
  return handleEventHub(eventHubApp, ...events);
}
```

Register it:

```ts
import { app, InvocationContext } from '@azure/functions';
import type { ReceivedEventData } from '@azure/event-hubs';
import { orderPlacedEventHub } from './functions.js';

app.eventHub('orderPlacedEventHub', {
  connection: 'EventHubConnection',
  eventHubName: 'orders',
  cardinality: 'many',
  handler: (events: unknown, _context: InvocationContext) =>
    orderPlacedEventHub(events as ReceivedEventData[]),
});
```

### Kafka

```bash
npm install @benzene/azure-function-kafka
```

Works against Event Hubs' Kafka-compatible endpoint. Like Service Bus, the Kafka record carries its own
topic, so Benzene dispatches by topic directly — `useKafka` configures the pipeline and
`handleKafkaEvents` dispatches the batch:

```ts
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { handleKafkaEvents, KafkaRecord, useKafka } from '@benzene/azure-function-kafka';
import { azureApp } from './azureApp.js';
import { NotifyWarehouseHandler } from './handlers.js';

const kafkaApp = azureApp((app) =>
  useKafka(app, (kafka) => useMessageHandlers(kafka, NotifyWarehouseHandler)),
);

export function orderPlacedKafka(records: KafkaRecord[]): Promise<void> {
  return handleKafkaEvents(kafkaApp, ...records);
}
```

`@azure/functions` v4 has no first-class Kafka registration helper (unlike `app.serviceBusQueue` /
`app.eventHub`), so `@benzene/azure-function-kafka` models the record shape it reads locally as
`KafkaRecord` (`{ topic, value }`, the `value` being UTF-8 JSON). Register the trigger with the generic
`app.generic(...)` API, filling in your Kafka trigger binding, and map the host's binding data into
`KafkaRecord[]` before forwarding. `useKafka` accepts the same optional `KafkaOptions`
(`catchExceptions` / `raiseOnFailureStatus`) as Service Bus.

### Other triggers

The .NET library's other Azure triggers are ported too, each in its own package following the same
`use…` / `handle…` shape as the Service Bus and Event Hub sections above — register the trigger with
`@azure/functions` and forward the host's binding data into a Benzene context:

| Trigger | Package | Entry points |
|---|---|---|
| Cosmos DB Change Feed | `@benzene/azure-function-cosmos-db` | `useCosmosDbChangeFeed` / `handleCosmosDbChanges` |
| Queue Storage | `@benzene/azure-function-queue-storage` | `useQueueStorage` / `handleQueueMessages` |
| Blob Storage | `@benzene/azure-function-blob-storage` | `useBlob` / `handleBlob` |
| Event Grid | `@benzene/azure-function-event-grid` | `useEventGrid` / `handleEventGridEvents` |
| Timer | `@benzene/azure-function-timer` | `useTick` / `handleTimer` |

## Correlation and tracing

The same diagnostics that work on every Benzene host work here — register them in `configureServices`.
`addDiagnostics(services)` (from `@benzene/diagnostics`, over `@opentelemetry/api`) wraps each middleware
in a span tagged with the topic, transport, handler, and status. For the header-based correlation-ID
alternative and how it propagates across services, see [Correlation IDs](correlation-ids.md).

## Testing

You don't need `func start` or a real broker to test a Benzene Azure function. Build the app the same way
your `azureApp` helper does, construct a native trigger payload with `@benzene/azure-function-testing`,
and invoke the callback directly. The builders (`asAzureHttpRequest`, `asAzureServiceBusMessage`,
`asEventHubBenzeneMessage`, `asAzureKafkaEvent`) turn a `httpBuilder` / `messageBuilder` from
`@benzene/testing` into the matching native event:

```ts
import { describe, expect, it } from 'vitest';
import { httpBuilder, messageBuilder } from '@benzene/testing';
import {
  asAzureHttpRequest,
  asAzureServiceBusMessage,
} from '@benzene/azure-function-testing';
import { orderPlacedServiceBus, placeOrderHttp } from './functions.js';

describe('azure functions', () => {
  it('HTTP: POST /orders returns a 201 confirmation', async () => {
    const request = asAzureHttpRequest(httpBuilder('POST', '/orders', { customerId: 'acme' }));

    const response = await placeOrderHttp(request);

    expect(response.status).toBe(201); // BenzeneResult.created -> 201
    expect(JSON.parse(response.body as string)).toEqual({ orderId: 'order-acme' });
  });

  it('Service Bus: each message routes to the warehouse consumer', async () => {
    await orderPlacedServiceBus([
      asAzureServiceBusMessage(messageBuilder('order:placed', { orderId: 'order-1' })),
      asAzureServiceBusMessage(messageBuilder('order:placed', { orderId: 'order-2' })),
    ]);
    // assert your handler's side effects
  });
});
```

This is exactly how `test/Benzene.Core.Test/Examples/AzureFunctionsExampleTest.test.ts` drives the
runnable example. See [Testing Benzene](testing-benzene.md) for the full picture.

## Troubleshooting

- **404 on every route locally, but the function runs**: Azure Functions prefixes every HTTP route with
  `/api` by default, so `/orders` is served at `/api/orders`. Clear it with `"routePrefix": ""` under
  `extensions.http` in `host.json`.
- **`func start` finds no functions**: confirm `main` in `package.json` points at the built file(s) that
  call `app.http(...)` / `app.serviceBusQueue(...)` (e.g. `dist/registrations.js`), and that you ran
  `npm run build` first — the Node runtime loads compiled JavaScript, not your `.ts` sources.
- **A non-HTTP trigger never fires locally**: every trigger except HTTP needs `AzureWebJobsStorage` to be
  a real connection — the empty string in step 7 is enough for HTTP only. Run
  [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite) and set
  `"AzureWebJobsStorage": "UseDevelopmentStorage=true"`, plus the trigger's own connection setting
  (`ServiceBusConnection`, `EventHubConnection`, …) pointing at a real namespace or emulator.
- **Handler never gets called**: confirm the handler module is imported (so its `@message` /
  `@httpEndpoint` decorators run and self-register it) and passed to `useMessageHandlers(pipeline, …)`.
  For Service Bus, also confirm the sender sets the `"topic"` application property — without it the
  message routes to the `<missing>` topic and matches no handler.
- **Two transports on one app collide**: build one `azureApp(...)` per trigger. A single container can't
  host two transports under type erasure — see the note in step 4.

## See Also

- [Getting Started](getting-started.md) — build the same handler locally on Express first
- [AWS Lambda Setup](getting-started-aws.md) — the same handler on API Gateway, SQS, SNS, EventBridge, Kafka
- [Message Handlers](message-handlers.md) — the full picture on `@message`, `@httpEndpoint`, and discovery
- [Middleware](middleware.md) and [Common Middleware](common-middleware.md) — what else composes into the pipeline
- [Validation](validation.md) — reject bad requests before they reach your handler
- [Correlation IDs](correlation-ids.md) — trace requests end-to-end
- [Testing Benzene](testing-benzene.md) — test handlers in isolation and pipelines end-to-end
- [Cookbooks](cookbooks/README.md) — real-world recipes
- [`examples/azure-functions`](../examples/azure-functions) — a complete, runnable project: one order domain on HTTP, Service Bus, and Event Hub

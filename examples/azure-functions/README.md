# `@benzene-example/azure-functions`

One order domain, **hosted on three Azure Functions triggers**. The handlers in
[`src/handlers.ts`](src/handlers.ts) are **identical in shape to the AWS Lambda example's**
([`examples/aws-lambda-functions`](../aws-lambda-functions)) — the same handler runs on both clouds
unchanged, which is the whole point of Benzene.

| Handler (`src/functions.ts`) | StartUp (`src/startUp.ts`) | Azure trigger | Handler | Routes by |
|---|---|---|---|---|
| `placeOrderHttp` | `HttpStartUp` | HTTP | `PlaceOrderHandler` | method + route (`POST /orders`) → topic `order:place` |
| `orderPlacedServiceBus` | `ServiceBusStartUp` | Service Bus (batched) | `NotifyWarehouseHandler` | `topic` application property → `order:placed` |
| `orderPlacedEventHub` | `EventHubStartUp` | Event Hub (batched) | `NotifyWarehouseHandler` | the BenzeneMessage envelope's topic → `order:placed` |

Each trigger is a `BenzeneStartUp` — the same contract as the AWS Lambda example's — booted with the
one-liner `new AzureFunctionHost(StartUp)`, whose native-trigger getter is the exported handler:

```ts
// src/startUp.ts — select Azure with useAzureFunctions, exactly as AWS selects it with useAwsLambda
export class ServiceBusStartUp implements BenzeneStartUp {
  configureServices(services) { addBenzene(services); }
  configure(app) {
    useAzureFunctions(app, (az) => useServiceBus(az, (sb) => useMessageHandlers(sb, NotifyWarehouseHandler)));
  }
}

// src/functions.ts — one-liner boot; `.serviceBusFunction` lights up on importing the transport package
export const orderPlacedServiceBus = new AzureFunctionHost(ServiceBusStartUp).serviceBusFunction;
```

The idiomatic Azure Functions v4 registrations that bind these to real triggers are in
[`src/registrations.ts`](src/registrations.ts) — the `app.http(...)` / `app.serviceBusQueue(...)` /
`app.eventHub(...)` shape the host loads:

```ts
app.http('placeOrder', { methods: ['POST'], route: 'orders', handler: placeOrderHttp });
```

(That module registers with the `@azure/functions` runtime on import, so it is loaded by the host, not
by the tests.)

## Verify it

`test/Benzene.Core.Test/Examples/AzureFunctionsExampleTest.test.ts` builds each trigger's payload with
`@benzene/azure-function-testing` (`asAzureHttpRequest` / `asAzureServiceBusMessage` /
`asEventHubBenzeneMessage`) and invokes each callback, asserting the shared handler ran — proof the "one
domain, three triggers" wiring routes end-to-end.

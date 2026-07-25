# `@benzene-example/azure-functions`

One order domain, **hosted on three Azure Functions triggers**. The handlers in
[`src/handlers.ts`](src/handlers.ts) are **identical in shape to the AWS Lambda example's**
([`examples/aws-lambda-functions`](../aws-lambda-functions)) — the same handler runs on both clouds
unchanged, which is the whole point of Benzene.

| Callback (`src/functions.ts`) | Azure trigger | Handler | Routes by |
|---|---|---|---|
| `placeOrderHttp` | HTTP | `PlaceOrderHandler` | method + route (`POST /orders`) → topic `order:place` |
| `orderPlacedServiceBus` | Service Bus (batched) | `NotifyWarehouseHandler` | `topic` application property → `order:placed` |
| `orderPlacedEventHub` | Event Hub (batched) | `NotifyWarehouseHandler` | the BenzeneMessage envelope's topic → `order:placed` |

Each callback dispatches its trigger's payload into a Benzene app via the transport's `handle*` helper,
e.g.:

```ts
const serviceBusApp = azureApp((app) =>
  useServiceBus(app, (sb) => useMessageHandlers(sb, NotifyWarehouseHandler)),
);

export function orderPlacedServiceBus(messages: ServiceBusReceivedMessage[]): Promise<void> {
  return handleServiceBusMessages(serviceBusApp, ...messages);
}
```

The idiomatic Azure Functions v4 registrations that bind these to real triggers are in
[`src/registrations.ts`](src/registrations.ts) — the `app.http(...)` / `app.serviceBusQueue(...)` /
`app.eventHub(...)` shape the host loads:

```ts
app.http('placeOrder', { methods: ['POST'], route: 'orders', handler: (r) => placeOrderHttp(r) });
```

(That module registers with the `@azure/functions` runtime on import, so it is loaded by the host, not
by the tests.)

## Verify it

`test/Benzene.Core.Test/Examples/AzureFunctionsExampleTest.test.ts` builds each trigger's payload with
`@benzene/azure-function-testing` (`asAzureHttpRequest` / `asAzureServiceBusMessage` /
`asEventHubBenzeneMessage`) and invokes each callback, asserting the shared handler ran — proof the "one
domain, three triggers" wiring routes end-to-end.

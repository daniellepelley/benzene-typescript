# Unified Hosting Model

Benzene lets you write one message handler and run it, unchanged, on Express, AWS Lambda, Azure
Functions, Google Cloud Functions, or a self-hosted worker process. Only the small piece of code that wires a transport to
your handler changes between hosts — the handler itself never moves.

> **TypeScript port.** This is the TypeScript port of [Benzene](https://github.com/daniellepelley/benzene).
> The .NET original centres this model on a single `BenzeneStartUp` class run through per-platform
> **production host adapters**. **Those `*Host<TStartUp>` production hosts ARE now ported for the three
> serverless clouds** — `AwsLambdaHost<TStartUp>` (`@benzenejs/aws-lambda-core`),
> `AzureFunctionHost<TStartUp>` (`@benzenejs/azure-function-core`), and `GoogleCloudFunctionHost<TStartUp>` /
> `GooglePubSubFunctionHost<TStartUp>` (`@benzenejs/google-cloud-functions-*`). You write one `StartUp`
> implementing the canonical `BenzeneStartUp` contract (from `@benzenejs/abstractions-middleware`) and boot
> it with a **one-liner** — `export const handler = new AwsLambdaHost(StartUp).lambdaHandler`,
> `new AzureFunctionHost(StartUp).httpFunction`, `new GoogleCloudFunctionHost(StartUp).httpFunction` — the
> SAME composition root a component test boots (`benzeneTestHost(StartUp)`), so what you test is what
> deploys. This is the **recommended entry** for all three clouds.
>
> The terse fluent **inline builders** (`InlineAwsLambdaStartUp`, `InlineAzureFunctionStartUp`,
> `InlineSelfHostedStartUp`) remain for inline tests and small standalone hosts — the advanced/terse
> alternative, built over the same platform-neutral `IBenzeneApplicationBuilder` model described below.
> Express is a middleware factory (`benzene(...)`); the self-hosted worker keeps its inline builder (no
> `*Host` production adapter — it owns its own process lifecycle). Where a shape differs, the README's
> [Porting conventions](../README.md#porting-conventions) explain why.

## The through-line: one handler, many hosts

Benzene separates *what your service does* from *how it's invoked*:

- A **message handler** contains your logic. It receives a typed request and returns a typed
  [result](message-result.md). It knows nothing about HTTP, Lambda, queues, or workers.
- Each handler is mapped to a **topic** — a stable string like `order:place` — via the `@message`
  decorator, and (for HTTP) to a method and path via `@httpEndpoint`. Every transport routes by topic.
- A **transport pipeline**, built inside a host's entry point, turns an incoming request or event into a
  message, routes it to the matching handler by topic, and turns the [result](message-result.md) back
  into a transport-native response.

Because only the transport pipeline changes between hosts, the handler runs unchanged everywhere. This
page shows the *same* handler served five ways.

## Three ways Benzene starts

Every host below falls into one of three execution models. Which one you're in determines who owns the
process and whether anything is listening or polling.

**1. Triggered (serverless)** — AWS Lambda, Azure Functions, Google Cloud Functions. Nothing runs until
the platform invokes your code for a single event. There is no Benzene-owned process and nothing polls;
the platform's own infrastructure (API Gateway, an SQS/Service Bus/Event Hub trigger, an HTTP/Pub/Sub
Cloud Function, …) calls into a cold or warm instance per invocation. See
[AWS Lambda Setup](getting-started-aws.md), [Azure Functions Setup](azure-functions.md), and
[Google Cloud Functions](getting-started-google.md).

**2. Embedded in an existing host** — Express. A pre-existing, already-long-running listener owns the
process and its own concurrency model: one incoming request is one async call. Benzene is just
middleware inside that pipeline — the value `benzene(...)` returns — and never starts, stops, or paces
anything about the host process. This is the TypeScript port's counterpart to the .NET `Benzene.AspNet.Core`
host on Kestrel.

**3. Self-hosted worker** — `@benzenejs/self-host`. Here Benzene itself owns a long-running consumer that
actively receives work (a broker poll loop) and keeps the process alive — no external infrastructure
invokes you, and no separate host is already listening. This is the one mode where how many events run
*at once* is Benzene's own decision; see [Worker concurrency](#worker-concurrency).

> **Not yet ported.** One host shape from the .NET model has no TypeScript equivalent: ASP.NET Core /
> Kestrel. Use Express in its place — either as middleware inside your own app (`benzene(...)`) or as a
> Benzene-owned listener worker (`useExpress`, below). The .NET generic-host adapter
> (`Benzene.HostedService`) has a counterpart: `BenzeneHost` in `@benzenejs/self-host` owns a worker
> process's start/stop lifecycle, so `BenzeneHost.runAsync(StartUp)` is the whole entry point. gRPC
> hosting *is* ported — `@benzenejs/grpc`'s `useGrpc` bridges a `@grpc/grpc-js`
> `Server` into the same handler pipeline (the grpc-js `Server` replaces .NET's ASP.NET-hosted gRPC). And
> on the self-hosted side, both the platform-neutral worker *scaffolding* (`@benzenejs/self-host`) **and**
> the ready-made broker/stream consumers — SQS, Service Bus, Event Hub, RabbitMQ, Kafka, and the Cosmos DB
> change feed — are ported, each added with a `use*` call on the worker startup. See
> [Self-hosted worker](#self-hosted-worker--inlineselfhostedstartup) below.

## The shared handler

Write this once. It's the only file you carry over verbatim between every host on this page:

```ts
// src/handlers.ts
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

`@message('order:place', …)` maps the handler to its topic and self-registers it when the module loads;
`@httpEndpoint('POST', '/orders')` maps an HTTP method and path onto that same topic. See
[Message Handlers](message-handlers.md) for the full picture.

## The same handler on five hosts

Every snippet below serves the exact `PlaceOrderHandler` above. Notice the shape is always the same:
build a transport pipeline, and inside it call `useMessageHandlers(pipeline, PlaceOrderHandler)` — the
step that routes a matched request to its handler by topic. Pass every handler class you want served.

### Express — `benzene(...)`

Package: `@benzenejs/express`. `benzene(...)` returns Express middleware that inserts Benzene into the
request pipeline; the transport pipeline is configured in the callback it takes.

```ts
// src/index.ts
import express from 'express';
import { useMessageHandlers } from '@benzenejs/core-message-handlers';
import { benzene } from '@benzenejs/express';
import { PlaceOrderHandler } from './handlers.js';

const app = express();

// Mount Benzene BEFORE any body parser so it reads the raw request body.
app.use(benzene((pipeline) => useMessageHandlers(pipeline, PlaceOrderHandler)));

app.listen(3000, () => console.log('Listening on http://localhost:3000'));
```

The Benzene middleware only responds to requests that match one of your `@httpEndpoint` routes; anything
else falls through to the rest of the Express app, so it coexists cleanly with existing routes. See
[Getting Started](getting-started.md) for the full walkthrough.

### AWS Lambda — `AwsLambdaHost`

Package: `@benzenejs/aws-lambda-core` (plus one transport package per event source) — or the
`@benzenejs/aws-lambda` umbrella, which bundles the core and every event-source transport under one
install and re-exports the granular names shown here (as [AWS Lambda Setup](getting-started-aws.md)
uses). Like Azure and Google, the AWS host is the host-class shape: you write one `StartUp` class
implementing the same `BenzeneStartUp` contract as every other host, pass it to `AwsLambdaHost`, and
export its `.lambdaHandler`. Inside `configure`, select AWS with `useAwsLambda(app, aws => …)`:

```ts
// src/startUp.ts
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneConfiguration, BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { useAwsLambda } from '@benzenejs/aws-lambda-core';
import { useApiGateway } from '@benzenejs/aws-lambda-api-gateway';
import { PlaceOrderHandler } from './handlers.js';

export class StartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    addBenzene(services);
  }
  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useAwsLambda(app, (aws) => useApiGateway(aws, (api) => useMessageHandlers(api, PlaceOrderHandler)));
  }
}
```

```ts
// src/handler.ts — the one-liner boot AWS invokes.
import { AwsLambdaHost } from '@benzenejs/aws-lambda-core';
import { StartUp } from './startUp.js';

export const handler = new AwsLambdaHost(StartUp).lambdaHandler;
```

The one-liner `new AwsLambdaHost(StartUp).lambdaHandler` boots the same `StartUp` a component test boots
(`benzeneTestHost(StartUp).buildAwsLambdaHost()`), so what you test is what deploys.

> **Export the bound handler.** Always write `export const handler = new AwsLambdaHost(StartUp).lambdaHandler`,
> never `export const handler = host.functionHandlerAsync` — assigning the method detaches `this` and the
> pipeline is lost at the first invocation. See [AWS Lambda Setup](getting-started-aws.md).
>
> **`InlineAwsLambdaStartUp` still works.** The terse fluent inline builder remains for inline tests and
> small standalone hosts (`new InlineAwsLambdaStartUp().configure(app => useApiGateway(app, …)).build()`
> returns the entry point, wrapped with `toLambdaHandler(...)`). The `AwsLambdaHost` one-liner is the
> taught path.

### Azure Functions — `AzureFunctionHost`

Package: `@benzenejs/azure-function-core` (plus one transport package per trigger type). Like Google, the
Azure host is the host-class shape: you write one `StartUp` class implementing the same
`BenzeneStartUp` contract as every other host, pass it to `AzureFunctionHost`, and it hands you the
native-trigger handler to register with the `@azure/functions` v4 API. Inside `configure`, select Azure
with `useAzureFunctions(app, az => …)` — the exact counterpart of AWS's `useAwsLambda(app, aws => …)`:

```ts
// src/startUp.ts
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneConfiguration, BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { useAzureFunctions } from '@benzenejs/azure-function-core';
import { useAzureHttp } from '@benzenejs/azure-function-http';
import { PlaceOrderHandler } from './handlers.js';

export class HttpStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    addBenzene(services);
  }
  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useAzureFunctions(app, (az) => useAzureHttp(az, (http) => useMessageHandlers(http, PlaceOrderHandler)));
  }
}
```

```ts
// src/functions.ts — importing the HTTP package lights up the host's `.httpFunction` getter.
import { AzureFunctionHost } from '@benzenejs/azure-function-core';
import '@benzenejs/azure-function-http';
import { HttpStartUp } from './startUp.js';

/** The `@azure/functions` HTTP handler to register with `app.http(...)`. */
export const placeOrderHttp = new AzureFunctionHost(HttpStartUp).httpFunction;
```

The one-liner `new AzureFunctionHost(StartUp).httpFunction` boots the same `StartUp` a component test
boots (`benzeneTestHost(StartUp).buildAzureFunctionApp()`), so what you test is what deploys. Each
trigger package adds its own getter — `.serviceBusFunction` (`@benzenejs/azure-function-service-bus`),
`.eventHubFunction` (`@benzenejs/azure-function-event-hub`) — over its `handle*` dispatch, so a fire-and-forget
trigger reads the same way. You then register `placeOrderHttp` with `app.http(...)` at module load. See
[Azure Functions Setup](azure-functions.md) for registration, `host.json`, and non-HTTP triggers.

> **`InlineAzureFunctionStartUp` still works.** The fluent inline builder remains for inline tests and
> small standalone hosts (`new InlineAzureFunctionStartUp().configure(app => useAzureHttp(app, …)).build()`
> returns the `IAzureFunctionApp` directly). The `AzureFunctionHost` one-liner is the taught path.

### Google Cloud Functions — `GoogleCloudFunctionHost`

Package: `@benzenejs/google-cloud-functions-http` (HTTP) and `@benzenejs/google-cloud-functions-pubsub`
(Pub/Sub). The same host-class shape as AWS and Azure: you write one `StartUp` implementing the same
`BenzeneStartUp` contract, pass it to `GoogleCloudFunctionHost`, and export its `.httpFunction`. Inside
`configure`, select Google with `useGoogleCloud(app, g => …)` — the exact counterpart of AWS's
`useAwsLambda(app, aws => …)` and Azure's `useAzureFunctions(app, az => …)`:

```ts
// src/startUp.ts
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneConfiguration, BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { useGoogleCloud } from '@benzenejs/google-cloud-functions-core';
import { useHttp } from '@benzenejs/google-cloud-functions-http';
import { PlaceOrderHandler } from './handlers.js';

export class OrdersStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    addBenzene(services);
  }
  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useGoogleCloud(app, (g) => useHttp(g, (http) => useMessageHandlers(http, PlaceOrderHandler)));
  }
}
```

```ts
// src/function.ts — `.httpFunction` is the `HttpFunction` the Functions Framework invokes.
import { GoogleCloudFunctionHost } from '@benzenejs/google-cloud-functions-http';
import { OrdersStartUp } from './startUp.js';

export const ordersFunction = new GoogleCloudFunctionHost(OrdersStartUp).httpFunction;
```

For a Pub/Sub-triggered function, swap `useHttp` for `usePubSub` and `GoogleCloudFunctionHost` for
`GooglePubSubFunctionHost` (`.cloudEventFunction`) — everything else is identical. See
[Google Cloud Functions](getting-started-google.md) for the full walkthrough and deployment.

### Self-hosted worker — `BenzeneHost`

Package: `@benzenejs/self-host`. Unlike the hosts above, a worker owns a long-running process rather than
responding to an external caller. Declare the transports in a `BenzeneStartUp` and the entry point is one
line:

```ts
// src/startUp.ts — the only place hosting is described
export class OrdersStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _c: BenzeneConfiguration): void {
    services.addSingleton(IOrderStore, InMemoryOrderStore);
  }

  configure(app: IBenzeneApplicationBuilder, _c: BenzeneConfiguration): void {
    useWorker(app, (workers) => {
      useExpress(workers, { port: 8080 }, (http) => useMessageHandlers(http, PlaceOrderHandler));
      useSqs(workers, sqsConfig, sqsFactory, (sqs) => useMessageHandlers(sqs, PlaceOrderHandler));
    });
  }
}
```

```ts
// src/main.ts, entire
await BenzeneHost.runAsync(OrdersStartUp);
```

`runAsync` starts every worker, waits for `SIGINT`/`SIGTERM`, then stops them and drains. Adding a third
transport never touches `main.ts`. The counterpart of .NET's `BenzeneHost.RunAsync<TStartUp>(args)`.

#### Dropping a level

`runAsync` is composed from two public steps, and you can stop at either:

| Rung | Call | What you get |
| --- | --- | --- |
| Shorthand | `BenzeneHost.runAsync(StartUp)` | build + run + signals + shutdown |
| One down | `BenzeneHost.build(StartUp)` | the built `IBenzeneWorker`, not started (the seam a test uses) |
| One down | `BenzeneHost.runWorkerAsync(worker)` | signals + shutdown for a worker you built yourself |
| Explicit | `worker.startAsync(signal)` / `worker.stopAsync()` | everything by hand |

And `build` itself is only this, all public API:

```ts
const startUp = new OrdersStartUp();
const configuration = startUp.getConfiguration?.() ?? emptyConfiguration();
const container = new DefaultBenzeneServiceContainer();   // @benzenejs/dependencies
startUp.configureServices(container, configuration);
const builder = new WorkerApplicationBuilder(container);  // @benzenejs/self-host
startUp.configure(builder, configuration);
const worker = builder.createWorker(
  withStartUpChecks(container.createServiceResolverFactory()), // @benzenejs/core-message-handlers
);
```

`withStartUpChecks` is why a wiring mistake — two handlers on one topic, a transport pointed at nothing —
fails the process at start-up with a message naming the fix, rather than on the first message that reaches
the broken link. Every host runs it; `BenzeneHost.build` is no exception.

> `runAsync` waits for the **shutdown signal**, not for the workers. A polling worker's `startAsync` *is*
> its loop and resolves only once stopped, while a push-based one (kafkajs, an HTTP listener) resolves as
> soon as it is subscribed or bound — so "every worker's promise resolved" is not a reason to exit. A
> worker that *fails* to start does trigger shutdown, so the process never waits on a signal that will
> never come.

### Self-hosted worker, inline — `InlineSelfHostedStartUp`

For a test or a small script, `InlineSelfHostedStartUp` skips the startup class: register services and one
or more `IBenzeneWorker`s inline, then `build()` returns a single composite worker with
`startAsync`/`stopAsync` you drive from your process's lifecycle (or hand to
`BenzeneHost.runWorkerAsync`):

```ts
// src/worker.ts
import { addBenzene } from '@benzenejs/core-message-handlers';
import { InlineSelfHostedStartUp } from '@benzenejs/self-host';
import { OrdersConsumer } from './OrdersConsumer.js';

const worker = new InlineSelfHostedStartUp()
  .configure((workers) => workers.add((resolver) => new OrdersConsumer(resolver)))
  .configureServices((services) => addBenzene(services))
  .build();

// Signals + graceful shutdown, without the startup class:
await BenzeneHost.runWorkerAsync(worker);

// ...or entirely by hand, if you own the process lifecycle already:
// await worker.startAsync(signal);
// process.on('SIGTERM', () => void worker.stopAsync());
```

`workers.add((resolver) => …)` registers a factory that builds one worker from the invocation's resolver
factory; register several and `build()` composes them into one `CompositeBenzeneWorker` that starts and
stops them together (see [`@benzenejs/self-host`'s `CompositeBenzeneWorker`](https://github.com/daniellepelley/benzene-typescript/tree/main/src/Benzene.SelfHost)).

`OrdersConsumer` is your own `IBenzeneWorker` — a small interface with `startAsync(signal?)` /
`stopAsync(signal?)` (from `@benzenejs/abstractions-middleware`). Its poll loop receives broker messages
and dispatches each one into a Benzene message pipeline, so the *same* `PlaceOrderHandler` runs here too.

#### Ready-made self-hosted consumers

You rarely have to write that poll loop yourself. Each of the common brokers and change streams ships a
ready-made consumer worker in its own package, added with a `use*` free function that takes the
`configure` callback's worker startup (`IBenzeneWorkerStartup`) as its **first** argument — the same
free-function-taking-the-builder-first shape as the transport `use*` functions on the other hosts. The
call registers the consumer's services, builds its inner pipeline from the `action` you pass, and adds
the worker to the composite:

| Package | `use*` function | Transport | Inner pipeline |
| --- | --- | --- | --- |
| `@benzenejs/express` | `useExpress(workers, options, action)` | `"express"` | `useMessageHandlers(...)` |
| `@benzenejs/aws-sqs` | `useSqs(workers, config, clientFactory, action)` | `"sqs"` | `useMessageHandlers(...)` |
| `@benzenejs/azure-service-bus` | `useServiceBus(workers, config, clientFactory, action)` | `"service-bus"` | `useMessageHandlers(...)` |
| `@benzenejs/azure-event-hub` | `useEventHub(workers, config, processorClientFactory, action)` | `"event-hub"` | `useMessageHandlers(...)` |
| `@benzenejs/rabbitmq` | `useRabbitMq(workers, config, connectionFactory, action)` | `"rabbitmq"` | `useMessageHandlers(...)` |
| `@benzenejs/kafka-core` | `useKafka(workers, config, consumerFactory, action)` | `"kafka"` | `useMessageHandlers(...)` |
| `@benzenejs/azure-cosmos-db` | `useCosmosDbChangeFeed(workers, config, processorFactory, action)` | `"cosmos-db"` | `useStream(...)` |

`useExpress` is the odd one out: it *listens* rather than consumes, and it is the counterpart of .NET's
`UseAspNet` inside `UseWorker` — Benzene owns a `node:http` listener, so HTTP is one worker among several
and one process serves all of them. It is a different rung from [`benzene(...)`](#express--benzene): use
that when the process is *your* Express app and Benzene handles some of its routes and falls through for
the rest; use `useExpress` when the process is a Benzene service that happens to speak HTTP, where a
request no handler owns is a 404. Despite the name it adds no runtime dependency on Express.

The message-based consumers route by topic, so their `action` is the same
`useMessageHandlers(pipeline, PlaceOrderHandler)` you write on every other host — the *same*
`PlaceOrderHandler` runs unchanged. Only the first three arguments (the broker config and its client
factory) are broker-specific; each factory is the seam where you hand in your own SDK client so the
package prescribes nothing about your credentials or connection. Here's the SQS consumer, wired onto the
worker startup:

```ts
// src/worker.ts
import { SQSClient } from '@aws-sdk/client-sqs';
import { useMessageHandlers } from '@benzenejs/core-message-handlers';
import { SqsClientFactory, useSqs } from '@benzenejs/aws-sqs';
import { InlineSelfHostedStartUp } from '@benzenejs/self-host';
import { PlaceOrderHandler } from './handlers.js';

const worker = new InlineSelfHostedStartUp()
  .configure((workers) =>
    useSqs(
      workers,
      { queueUrl: process.env.QUEUE_URL!, maxNumberOfMessages: 10 },
      new SqsClientFactory(new SQSClient({})),
      (pipeline) => useMessageHandlers(pipeline, PlaceOrderHandler),
    ),
  )
  .build();

await worker.startAsync();
process.on('SIGTERM', () => void worker.stopAsync());
```

The `use*` call registers Benzene's base services itself, so you don't need a `configureServices`
`addBenzene` step for a worker that only hosts ready-made consumers. Register more than one — call
`useSqs`, `useRabbitMq`, … in the same `configure` body, each chaining on the same `workers` — and
`build()` composes them into one `CompositeBenzeneWorker` that starts and stops them together.

#### Cosmos DB change feed — `useCosmosDbChangeFeed`

The Cosmos DB change-feed consumer is the one stream (not message) transport here: changed documents
carry no message envelope, so its pipeline is a **streaming** pipeline over the document type
(`useStream(...)` from `@benzenejs/core-middleware`) rather than `useMessageHandlers`. This is the
standalone worker — distinct from the Azure Functions `CosmosDBTrigger` adapter
(`@benzenejs/azure-function-cosmos-db`, see [Azure Functions Setup](azure-functions.md)); reach for this
one when you want a long-running `@benzenejs/self-host` worker with manual per-batch checkpoint control.

Its third argument is an `ICosmosChangeFeedProcessorFactory<TDocument>` — the built-in
`CosmosChangeFeedProcessorFactory` takes the monitored container and an
`ICosmosChangeFeedCheckpointStore` (where the continuation-token checkpoint is persisted). The port
ships `InMemoryCosmosChangeFeedCheckpointStore` for dev and tests; it is **not durable** (tokens live
only for the process's lifetime, so a restart resumes from the config's `startFrom` rather than the last
processed change), so a production worker supplies its own store backed by a Cosmos container, blob,
table, etc.

```ts
// src/cosmos-worker.ts
import { CosmosClient } from '@azure/cosmos';
import { useStream } from '@benzenejs/core-middleware';
import {
  BenzeneCosmosChangeFeedConfig,
  CosmosChangeFeedProcessorFactory,
  InMemoryCosmosChangeFeedCheckpointStore,
  useCosmosDbChangeFeed,
} from '@benzenejs/azure-cosmos-db';
import { InlineSelfHostedStartUp } from '@benzenejs/self-host';

class OrderDocument {
  orderId?: string;
}

const container = new CosmosClient(process.env.COSMOS_CONNECTION_STRING!)
  .database('shop')
  .container('orders');

const worker = new InlineSelfHostedStartUp()
  .configure((workers) =>
    useCosmosDbChangeFeed<OrderDocument>(
      workers,
      new BenzeneCosmosChangeFeedConfig(),
      new CosmosChangeFeedProcessorFactory<OrderDocument>(
        container,
        // Dev/test only — production needs a durable checkpoint store.
        new InMemoryCosmosChangeFeedCheckpointStore(),
      ),
      (feed) =>
        useStream<OrderDocument>(feed, async (documents: AsyncIterable<OrderDocument>) => {
          for await (const document of documents) {
            console.log('changed order', document.orderId);
          }
        }),
    ),
  )
  .build();

await worker.startAsync();
process.on('SIGTERM', () => void worker.stopAsync());
```

For deletes and intermediate versions, `useCosmosDbAllVersionsChangeFeed(...)` is the
all-versions-and-deletes sibling: its stream is over `CosmosChangeFeedItem<TDocument>` (current +
previous + change type) instead of the bare document, and — being automatic-checkpoint only — its config
is `BenzeneCosmosAllVersionsChangeFeedConfig`. It requires the caller to have configured container/account
retention, otherwise deletes and intermediate versions don't surface.

If none of the ready-made consumers fits your broker, you can still write your own `IBenzeneWorker` and
register it with `workers.add((resolver) => …)`, exactly as the `OrdersConsumer` example above does.

## Two AWS deployment shapes

On AWS you have a deployment choice that doesn't change the transport wiring inside `configure`:

- **Model A — one Lambda function per transport (the default).** Each transport gets its own `StartUp`
  and its own exported `handler` (`new AwsLambdaHost(StartUp).lambdaHandler`), deployed as a separate
  function with its own trigger. This is the port's default because under TypeScript's type erasure two
  transports can't share one DI container. (The runnable
  [`examples/aws-lambda-functions`](../examples/aws-lambda-functions) is exactly this — one domain, five
  transports, each its own `StartUp` + host one-liner.)
- **Model B — one Lambda function, several triggers (`compositeAwsLambda`).** One exported `handler`
  fronts several transports, each kept in its own isolated container/pipeline; an event-shape predicate
  (`isApiGatewayEvent`, `isSqsEvent`, …) picks the matching route per event.

Both are covered in full, with runnable code, in
[AWS Lambda Setup](getting-started-aws.md#7-add-a-second-transport).

## `IBenzeneApplicationBuilder`

The `app` passed to each host's `configure` step is an `IBenzeneApplicationBuilder`
(`@benzenejs/abstractions-middleware`) — the platform-neutral builder every host implements:

```ts
export interface IBenzeneApplicationBuilder extends IRegisterDependency {
  readonly platform: string;              // "AwsLambda", "AzureFunctions", "Worker", ...
  create<TContext>(): IMiddlewarePipelineBuilder<TContext>;
}
```

- **`platform`** — the hosting platform identifier for the concrete builder instance (`"AwsLambda"`,
  `"AzureFunctions"`, `"Worker"`, …). It's also what `IBenzeneInvocation.platform` reports for the
  matching invocation (below).
- **`create<TContext>()`** — creates a new pipeline builder sharing this builder's DI container. The
  transport `use*` free functions use it internally; you rarely call it directly.
- **`register(...)`** (from `IRegisterDependency`) — runs an action against the underlying Benzene
  service container, for middleware that registers its own dependencies as a side effect.

Each platform's `use*` transport function is a free function taking the builder first and pattern-matching
on the concrete builder type, so calling the wrong one for the running host is a safe no-op. `useWorker`
(from `@benzenejs/self-host`) is the clearest example:

```ts
export function useWorker(
  app: IBenzeneApplicationBuilder,
  configure: (workers: IBenzeneWorkerStartup) => void,
): IBenzeneApplicationBuilder {
  if (app instanceof WorkerApplicationBuilder) {
    configure(app.workers);
  }
  return app;
}
```

This is the free-function port of the .NET `Use*` extension methods (see the
[Porting conventions](../README.md#porting-conventions)), and it's why a `configure` body can call
`useWorker(...)` even under a host that isn't the worker host — it simply does nothing there.

## `IBenzeneInvocation`

`IBenzeneInvocation` (`@benzenejs/abstractions-middleware`) is a platform-neutral bag of metadata about the
current invocation, so a handler can stay portable while still reaching native platform context when it
genuinely needs to:

```ts
export interface IBenzeneInvocation {
  readonly invocationId: string;
  readonly platform: string;
  getFeature<T>(feature: ServiceIdentifier<T>): T | undefined;
}
```

- **`invocationId`** — an identifier unique enough to correlate logs/traces for this invocation (e.g. the
  AWS Lambda request ID).
- **`platform`** — matches `IBenzeneApplicationBuilder.platform` for the host that populated it.
- **`getFeature<T>(feature)`** — returns the native platform feature keyed by `feature` (e.g. the Lambda
  `Context`), or `undefined` if this platform doesn't expose one. C#'s `GetFeature<T>()` keys the bag by
  the runtime `Type` of `T`, which TypeScript erases, so the port takes an explicit
  `ServiceIdentifier<T>` — the same runtime stand-in used for service resolution.

Enable it by calling `useBenzeneInvocation()` on the pipeline builder inside `configure`; resolve
`IBenzeneInvocation` as a scoped dependency. It's populated once per pipeline by whichever level's
`useBenzeneInvocation()` you called, so call it at the level you need it resolvable from.

> **Port scope.** `useBenzeneInvocation()` is wired for AWS Lambda (`@benzenejs/aws-lambda-core`, where
> `invocationId` is the Lambda request ID and `getFeature` exposes the Lambda `Context`) over the
> platform-neutral core (`@benzenejs/core-middleware`). The Express and Azure Functions accessors from the
> .NET model aren't ported yet.

## Worker concurrency

For the self-hosted worker (mode 3), how many events run *at once* is Benzene's decision. The port ships
`BoundedConcurrentDispatcher<T>` (`@benzenejs/self-host`) — a fan-out primitive a worker's poll loop hands
each received item to:

```ts
new BoundedConcurrentDispatcher<Message>(laneCount, handle, logger, {
  keySelector: (m) => m.partition,   // same key → same lane → per-key order preserved
  catchExceptions: true,             // default: a lane logs and swallows a fault, keeps consuming
});
```

- **`laneCount`** caps how many handlers run concurrently — one dedicated consumer per lane.
- **`keySelector`** routes items sharing a key to the same lane, preserving per-key order while different
  keys run concurrently up to `laneCount`. Omit it for unordered round-robin dispatch.
- Each lane's channel has **capacity 1**, so `enqueueAsync` blocks once a lane already has one item
  queued behind the one in flight — that's the poll loop's backpressure.
- **`drainAsync(drainTimeoutMs)`** waits up to the timeout for in-flight work to finish before
  abandoning it, so a worker's `stopAsync` can drain gracefully.

Node has no `System.Threading.Channels`, so the used subset is re-created in-package as a capacity-1
single-reader `BoundedChannel`. The [ready-made consumers](#ready-made-self-hosted-consumers) wire this
dispatcher for you and surface its knobs on their configs — e.g. `concurrentRequests` and
`preserveOrderPerPartition` on the Kafka config, `prefetchCount`/`concurrentRequests`/`drainTimeoutMs` on
RabbitMQ, `maxConcurrentCalls`/`prefetchCount` on Service Bus — so you rarely touch
`BoundedConcurrentDispatcher` directly. Reach for it only when you write your own `IBenzeneWorker`, where
you hand each received item to it yourself.

## Testing

You don't need a real cloud host to test any of these. Build the same entry point your host ships,
construct a native event with the transport's test helper, and invoke it — the request runs your real
pipeline end-to-end. `@benzenejs/testing` supplies the payload builders (`httpBuilder`, `messageBuilder`),
and `@benzenejs/aws-lambda-testing` / `@benzenejs/azure-function-testing` turn them into native events. See
[Testing Benzene](testing-benzene.md).

## See Also

- [Getting Started](getting-started.md) — build the same handler locally on Express first
- [AWS Lambda Setup](getting-started-aws.md) — API Gateway, SQS, SNS, EventBridge, Kafka, and the two
  deployment shapes
- [Azure Functions Setup](azure-functions.md) — the Azure Functions v4 model over HTTP, Service Bus, and
  Event Hub
- [Google Cloud Functions](getting-started-google.md) — the `GoogleCloudFunctionHost` model over HTTP + Pub/Sub
- [Message Handlers](message-handlers.md) — the handler contract, topics, and `@message`/`@httpEndpoint`
- [Message Result](message-result.md) — `BenzeneResult.ok`/`.created` and the result envelope
- [Middleware](middleware.md) and [Common Middleware](common-middleware.md) — what else composes into the pipeline
- [Correlation IDs](correlation-ids.md) — trace a request end-to-end across services
- [Testing Benzene](testing-benzene.md) — testing handlers and pipelines end-to-end
- [Cookbooks](cookbooks/README.md) — recipes for real-world scenarios

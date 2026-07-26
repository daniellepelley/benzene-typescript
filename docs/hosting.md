# Unified Hosting Model

Benzene lets you write one message handler and run it, unchanged, on Express, AWS Lambda, Azure
Functions, or a self-hosted worker process. Only the small piece of code that wires a transport to
your handler changes between hosts — the handler itself never moves.

> **TypeScript port.** This is the TypeScript port of [Benzene](https://github.com/daniellepelley/benzene-dotnet).
> The .NET original centres this model on a single `BenzeneStartUp` class run through per-platform host
> adapters (`AwsLambdaHost<TStartUp>`, `IHostBuilder.UseBenzene<TStartUp>()`). **That single-class host
> model has no port yet.** Instead each host exposes its own small fluent entry-point builder
> (`InlineAwsLambdaStartUp`, `InlineAzureFunctionStartUp`, `InlineSelfHostedStartUp`) or middleware
> factory (Express's `benzene(...)`), all built over the same platform-neutral
> `IBenzeneApplicationBuilder` model described below. Where the shape differs, the README's
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
page shows the *same* handler served four ways.

## Three ways Benzene starts

Every host below falls into one of three execution models. Which one you're in determines who owns the
process and whether anything is listening or polling.

**1. Triggered (serverless)** — AWS Lambda, Azure Functions. Nothing runs until the platform invokes
your code for a single event. There is no Benzene-owned process and nothing polls; the platform's own
infrastructure (API Gateway, an SQS/Service Bus/Event Hub trigger, …) calls into a cold or warm instance
per invocation. See [AWS Lambda Setup](getting-started-aws.md) and
[Azure Functions Setup](azure-functions.md).

**2. Embedded in an existing host** — Express. A pre-existing, already-long-running listener owns the
process and its own concurrency model: one incoming request is one async call. Benzene is just
middleware inside that pipeline — the value `benzene(...)` returns — and never starts, stops, or paces
anything about the host process. This is the TypeScript port's counterpart to the .NET `Benzene.AspNet.Core`
host on Kestrel.

**3. Self-hosted worker** — `@benzene/self-host`. Here Benzene itself owns a long-running consumer that
actively receives work (a broker poll loop) and keeps the process alive — no external infrastructure
invokes you, and no separate host is already listening. This is the one mode where how many events run
*at once* is Benzene's own decision; see [Worker concurrency](#worker-concurrency).

> **Not yet ported.** The .NET model also covers ASP.NET Core / Kestrel and gRPC hosts, the generic
> `IHostedService` worker host (`Benzene.HostedService`), and ready-made broker consumers
> (`BenzeneKafkaWorker`, `RabbitMqWorker`, the Azure Service Bus/Event Hub self-hosted workers). Of these,
> only the platform-neutral worker *scaffolding* (`@benzene/self-host`) is ported — the concrete broker
> consumers are not. Use Express in place of Kestrel, and supply your own `IBenzeneWorker` for a
> self-hosted consumer (below).

## The shared handler

Write this once. It's the only file you carry over verbatim between every host on this page:

```ts
// src/handlers.ts
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

`@message('order:place', …)` maps the handler to its topic and self-registers it when the module loads;
`@httpEndpoint('POST', '/orders')` maps an HTTP method and path onto that same topic. See
[Message Handlers](message-handlers.md) for the full picture.

## The same handler on four hosts

Every snippet below serves the exact `PlaceOrderHandler` above. Notice the shape is always the same:
build a transport pipeline, and inside it call `useMessageHandlers(pipeline, PlaceOrderHandler)` — the
step that routes a matched request to its handler by topic. Pass every handler class you want served.

### Express — `benzene(...)`

Package: `@benzene/express`. `benzene(...)` returns Express middleware that inserts Benzene into the
request pipeline; the transport pipeline is configured in the callback it takes.

```ts
// src/index.ts
import express from 'express';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { benzene } from '@benzene/express';
import { PlaceOrderHandler } from './handlers.js';

const app = express();

// Mount Benzene BEFORE any body parser so it reads the raw request body.
app.use(benzene((pipeline) => useMessageHandlers(pipeline, PlaceOrderHandler)));

app.listen(3000, () => console.log('Listening on http://localhost:3000'));
```

The Benzene middleware only responds to requests that match one of your `@httpEndpoint` routes; anything
else falls through to the rest of the Express app, so it coexists cleanly with existing routes. See
[Getting Started](getting-started.md) for the full walkthrough.

### AWS Lambda — `InlineAwsLambdaStartUp`

Package: `@benzene/aws-lambda-core` (plus one transport package per event source). The fluent
`InlineAwsLambdaStartUp` builds the pipeline once on cold start; `toLambdaHandler(entryPoint)` returns
the function AWS invokes.

```ts
// src/index.ts
import { addBenzene, useMessageHandlers } from '@benzene/core-message-handlers';
import { InlineAwsLambdaStartUp, toLambdaHandler } from '@benzene/aws-lambda-core';
import { useApiGateway } from '@benzene/aws-lambda-api-gateway';
import { PlaceOrderHandler } from './handlers.js';

const entryPoint = new InlineAwsLambdaStartUp()
  .configureServices((services) => addBenzene(services))
  .configure((app) => useApiGateway(app, (api) => useMessageHandlers(api, PlaceOrderHandler)))
  .build();

// `toLambdaHandler` returns the correctly-bound function AWS invokes.
export const handler = toLambdaHandler(entryPoint);
```

> **Export the bound handler.** Always write `export const handler = toLambdaHandler(entryPoint)`, never
> `export const handler = entryPoint.functionHandlerAsync` — assigning the method detaches `this` and the
> pipeline is lost at the first invocation. See [AWS Lambda Setup](getting-started-aws.md).

### Azure Functions — `InlineAzureFunctionStartUp`

Package: `@benzene/azure-function-core` (plus one transport package per trigger type).
`InlineAzureFunctionStartUp` builds an `IAzureFunctionApp` that dispatches an incoming request to the
matching handler; a trigger callback registered with the `@azure/functions` v4 API forwards each payload
into it via the transport's `handle*` helper.

```ts
// src/functions.ts
import { HttpRequest, HttpResponseInit } from '@azure/functions';
import { addBenzene, useMessageHandlers } from '@benzene/core-message-handlers';
import { InlineAzureFunctionStartUp } from '@benzene/azure-function-core';
import { handleHttpRequest, useAzureHttp } from '@benzene/azure-function-http';
import { PlaceOrderHandler } from './handlers.js';

const httpApp = new InlineAzureFunctionStartUp()
  .configureServices((services) => addBenzene(services))
  .configure((app) => useAzureHttp(app, (http) => useMessageHandlers(http, PlaceOrderHandler)))
  .build();

/** HTTP trigger: `POST /orders` returns an order confirmation. */
export function placeOrderHttp(request: HttpRequest): Promise<HttpResponseInit> {
  return handleHttpRequest(httpApp, request);
}
```

You then register `placeOrderHttp` with `app.http(...)` at module load. See
[Azure Functions Setup](azure-functions.md) for registration, `host.json`, and non-HTTP triggers.

### Self-hosted worker — `InlineSelfHostedStartUp`

Package: `@benzene/self-host`. Unlike the hosts above, a worker owns a long-running process rather than
responding to an external caller. `InlineSelfHostedStartUp` registers services and one or more
`IBenzeneWorker`s, then `build()` returns a single composite worker with `startAsync`/`stopAsync` you
drive from your process's lifecycle:

```ts
// src/worker.ts
import { addBenzene } from '@benzene/core-message-handlers';
import { InlineSelfHostedStartUp } from '@benzene/self-host';
import { OrdersConsumer } from './OrdersConsumer.js';

const worker = new InlineSelfHostedStartUp()
  .configure((workers) => workers.add((resolver) => new OrdersConsumer(resolver)))
  .configureServices((services) => addBenzene(services))
  .build();

await worker.startAsync();

// Keep the process alive; drain in-flight work on shutdown.
process.on('SIGTERM', () => void worker.stopAsync());
```

`workers.add((resolver) => …)` registers a factory that builds one worker from the invocation's resolver
factory; register several and `build()` composes them into one `CompositeBenzeneWorker` that starts and
stops them together (see [`@benzene/self-host`'s `CompositeBenzeneWorker`](https://github.com/daniellepelley/benzene-typescript/tree/main/src/Benzene.SelfHost)).

`OrdersConsumer` is your own `IBenzeneWorker` — a small interface with `startAsync(signal?)` /
`stopAsync(signal?)` (from `@benzene/abstractions-middleware`). Its poll loop receives broker messages
and dispatches each one into a Benzene message pipeline, so the *same* `PlaceOrderHandler` runs here too.

> **No ready-made broker consumer yet.** The .NET library ships Kafka, RabbitMQ, Service Bus, and Event
> Hub self-hosted workers; the TypeScript port ships only the worker *scaffolding*
> (`InlineSelfHostedStartUp`, the worker builder, `CompositeBenzeneWorker`, and
> `BoundedConcurrentDispatcher` — see below). You supply the consumer loop that reads your broker and
> dispatches into `useMessageHandlers`. Track the roadmap in the [README](../README.md#roadmap) rather
> than reaching for a broker worker that isn't there yet.

## Two AWS deployment shapes

On AWS you have a deployment choice that doesn't change the transport wiring inside `configure`:

- **Model A — one Lambda function per transport (the default).** Each transport gets its own
  `InlineAwsLambdaStartUp` and its own exported `handler`, deployed as a separate function with its own
  trigger. This is the port's default because under TypeScript's type erasure two transports can't share
  one DI container.
- **Model B — one Lambda function, several triggers (`compositeAwsLambda`).** One exported `handler`
  fronts several transports, each kept in its own isolated container/pipeline; an event-shape predicate
  (`isApiGatewayEvent`, `isSqsEvent`, …) picks the matching route per event.

Both are covered in full, with runnable code, in
[AWS Lambda Setup](getting-started-aws.md#7-add-a-second-transport).

## `IBenzeneApplicationBuilder`

The `app` passed to each host's `configure` step is an `IBenzeneApplicationBuilder`
(`@benzene/abstractions-middleware`) — the platform-neutral builder every host implements:

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
(from `@benzene/self-host`) is the clearest example:

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

`IBenzeneInvocation` (`@benzene/abstractions-middleware`) is a platform-neutral bag of metadata about the
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

> **Port scope.** `useBenzeneInvocation()` is wired for AWS Lambda (`@benzene/aws-lambda-core`, where
> `invocationId` is the Lambda request ID and `getFeature` exposes the Lambda `Context`) over the
> platform-neutral core (`@benzene/core-middleware`). The Express and Azure Functions accessors from the
> .NET model aren't ported yet.

## Worker concurrency

For the self-hosted worker (mode 3), how many events run *at once* is Benzene's decision. The port ships
`BoundedConcurrentDispatcher<T>` (`@benzene/self-host`) — a fan-out primitive a worker's poll loop hands
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
single-reader `BoundedChannel`. The .NET broker configs that expose these knobs by name
(`ConcurrentRequests`, `PreserveOrderPerPartition`, `PrefetchCount`, `DrainTimeout` on the Kafka/RabbitMQ/
Service Bus/Event Hub workers) aren't ported, because their broker consumers aren't; wire the dispatcher
into your own consumer directly.

## Testing

You don't need a real cloud host to test any of these. Build the same entry point your host ships,
construct a native event with the transport's test helper, and invoke it — the request runs your real
pipeline end-to-end. `@benzene/testing` supplies the payload builders (`httpBuilder`, `messageBuilder`),
and `@benzene/aws-lambda-testing` / `@benzene/azure-function-testing` turn them into native events. See
[Testing Benzene](testing-benzene.md).

## See Also

- [Getting Started](getting-started.md) — build the same handler locally on Express first
- [AWS Lambda Setup](getting-started-aws.md) — API Gateway, SQS, SNS, EventBridge, Kafka, and the two
  deployment shapes
- [Azure Functions Setup](azure-functions.md) — the Azure Functions v4 model over HTTP, Service Bus, and
  Event Hub
- [Message Handlers](message-handlers.md) — the handler contract, topics, and `@message`/`@httpEndpoint`
- [Message Result](message-result.md) — `BenzeneResult.ok`/`.created` and the result envelope
- [Middleware](middleware.md) and [Common Middleware](common-middleware.md) — what else composes into the pipeline
- [Correlation IDs](correlation-ids.md) — trace a request end-to-end across services
- [Testing Benzene](testing-benzene.md) — testing handlers and pipelines end-to-end
- [Cookbooks](cookbooks/README.md) — recipes for real-world scenarios
</content>
</invoke>

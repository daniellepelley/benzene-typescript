# Clients

Benzene clients let one Benzene service call another through a single topic-keyed outbound routing
table — you send by topic, and a pipeline built ahead of time carries the message to the right
transport.

## Overview

A Benzene service is a set of message handlers reachable by topic (see
[Message Handlers](message-handlers.md)). When one service needs to call another, its business logic
depends on just one interface, `IBenzeneMessageSender` (`@benzene/clients`):

```ts
export interface IBenzeneMessageSender {
  sendAsync<TRequest, TResponse>(
    topic: string,
    request: TRequest,
    headers?: Record<string, string>,
  ): Promise<IBenzeneResultOf<TResponse>>;
}
```

No service name, no client type, no factory resolution at the call site — just a topic and a request.
`addOutboundRouting(...)` builds one outbound pipeline per topic ahead of time (at startup), and
`sendAsync` routes to the right one. Cross-cutting behavior (W3C trace propagation, retry, parallel
fan-out) is added as ordinary `IMiddleware<OutboundContext>` on that pipeline — the same middleware
model used everywhere else in Benzene (see [Middleware](middleware.md)), so there's no separate
decorator mechanism to learn.

> **Port status.** The .NET transport route extensions that plug a specific broker into an outbound
> route — each `use*(route, …)` converting the route's terminal send to that transport — **are ported**
> for the common brokers:
>
> | Transport | Route extension | Package |
> | --- | --- | --- |
> | AWS SNS | `useSns` | `@benzene/clients-aws-sns` |
> | AWS SQS | `useSqs` | `@benzene/clients-aws-sqs` |
> | AWS EventBridge | `useEventBridge` | `@benzene/clients-aws-eventbridge` |
> | Azure Service Bus | `useServiceBus` | `@benzene/clients-azure-service-bus` |
> | Azure Event Hub | `useEventHub` | `@benzene/clients-azure-event-hub` |
> | Azure Event Grid | `useEventGrid` | `@benzene/clients-azure-event-grid` |
> | Azure Queue Storage | `useQueueStorage` | `@benzene/clients-azure-queue-storage` |
> | Google Cloud Pub/Sub | `usePubSub` | `@benzene/clients-google-cloud-pubsub` |
> | HTTP | on the message-sender path | `@benzene/clients-http` (see [HTTP](#http)) |
> | In-process (no wire) | `useInProcess` / `useInProcessFanOut` | `@benzene/clients-in-process` (see [In-process](#in-process)) |
>
> Each also auto-wires a non-destructive reachability check for its target on the dependency category
> (opt out with `healthCheck: false`). If a route has no broker extension, its terminal send is still
> whatever `IMiddleware<OutboundContext>` you add to it. **Still deferred:** the high-level AWS Lambda
> outbound route (`.useAwsLambda`) and Kafka/gRPC outbound route extensions — a low-level **AWS Lambda
> invoke** client does ship (see [AWS Lambda](#aws-lambda)), and Kafka has a send-side message client
> (`@benzene/kafka-core`'s `useKafkaSend`). See the [repository README package table](../README.md) for
> exactly what's ported.

## Installation

Install the core client package; add the HTTP and/or AWS Lambda packages as needed:

| Package | What it adds |
|---|---|
| `@benzene/clients` | `IBenzeneMessageSender`, `OutboundContext`, `OutboundRoutingBuilder` / `addOutboundRouting`, the parallel fan-out (`useParallel`) and outbound W3C trace-context (`useW3CTraceContext`) middleware, and the lower-level `IBenzeneMessageClient` decorator suite (`ClientBuilder`, `withRetry`, `withCorrelationId`, `sendMessageAsync`). |
| `@benzene/clients-http` | Outbound HTTP building blocks over the Node `fetch` API — `useHttp` / `useHttpClient` / `useHttpClientToSend`, `HttpContextConverter`, `HttpClientMiddleware`. |
| `@benzene/clients-aws-lambda` | `AwsLambdaClient` — the low-level AWS Lambda invoke client, over `@aws-sdk/client-lambda`. |
| `@benzene/clients-health-checks` | The consumer-side contract-drift health check (`ClientHealthCheck`, `addContractCheck`). |
| `@benzene/resilience` | `useRetry` — retry-with-backoff around any pipeline stage; works on `OutboundContext` unmodified (see [Resilience](resilience.md)). |

```bash
npm install @benzene/clients
```

## Basic usage

Register your routes once at startup, then resolve `IBenzeneMessageSender` and call `sendAsync`:

```ts
import { addOutboundRouting } from '@benzene/clients';

addOutboundRouting(services, (routing) =>
  routing
    .route('order:create', (pipeline) => pipeline.useService(SendToOrdersService))
    .route('audit:log', (pipeline) => pipeline.useService(SendToAuditService)));
```

```ts
import { IBenzeneResultOf, VoidResult } from '@benzene/abstractions';
import { IBenzeneMessageSender } from '@benzene/clients';

export class OrderClient {
  static readonly inject = [IBenzeneMessageSender] as const;
  constructor(private readonly sender: IBenzeneMessageSender) {}

  createOrderAsync(request: CreateOrderRequest): Promise<IBenzeneResultOf<VoidResult>> {
    return this.sender.sendAsync<CreateOrderRequest, VoidResult>('order:create', request);
  }
}
```

Pass per-call headers (e.g. a caller-supplied tenant value, distinct from anything a route's own
middleware adds statically) as the third argument:

```ts
await this.sender.sendAsync<CreateOrderRequest, VoidResult>(
  'order:create',
  request,
  { 'x-tenant-id': tenantId },
);
```

Sending to a topic with no registered route throws `UnroutedTopicException` (which names the topic).

## Wiring routes: `OutboundRoutingBuilder`

`addOutboundRouting(services, configure)` (a free function taking the container first — the port's
convention for a C# `IServiceCollection` extension) registers one
`IMiddlewarePipeline<OutboundContext>` per topic and the `IBenzeneMessageSender` that routes to them:

```ts
export class OutboundRoutingBuilder {
  route(topic: string, configure: (builder: IMiddlewarePipelineBuilder<OutboundContext>) => void): this;
  build(): Map<string, IMiddlewarePipeline<OutboundContext>>;
}
```

`.route(topic, configure)` builds an ordinary middleware pipeline over `OutboundContext` — the
outbound mirror of every inbound transport context in Benzene:

```ts
export class OutboundContext {
  readonly topic: string;                       // the topic being sent on
  readonly request: unknown;                    // the request payload
  readonly headers: Record<string, string>;     // per-call headers, never null (copied, not aliased)
  response: unknown;                            // set by transport middleware once the send completes
}
```

The terminal middleware of a route either sets an `IBenzeneResult` on `context.response` directly (a
fire-and-forget transport sets a `VoidResult`), **or** leaves a raw `BenzeneMessageClientResponse` envelope
for `sendAsync` to deserialize into the caller's `TResponse` — the path a response-bearing transport
(in-process; an HTTP message client) takes. If a route produces neither, `sendAsync` throws
`OutboundResponseTypeMismatchException`.

> **Erasure note.** For a response-bearing transport the body is deserialized into `TResponse` structurally
> (`JSON.parse` + a cast) — there is no runtime `TResponse` to validate against, so a body that doesn't match
> yields a mis-shaped object rather than an error (compose a validator on the response if that matters). And
> the .NET sender's finer check — `OutboundResponseTypeMismatchException` when the route produced an
> `IBenzeneResult<T>` of a *different* `T` — is not reproducible, since the port cannot observe `T`. A
> send-only topic (no response body) resolves to a `VoidResult`; route it through
> `sendAsync<TRequest, VoidResult>`.

Registering the same topic twice throws `DuplicateOutboundRouteException` — each topic gets exactly
one route.

## Outbound middleware

Cross-cutting concerns are ordinary `IMiddleware<OutboundContext>`, added to a route the same way you'd
add middleware to any other Benzene pipeline. Two are shipped in `@benzene/clients`, plus `useRetry`
from `@benzene/resilience`:

| Helper | Behavior |
|---|---|
| `useW3CTraceContext(pipeline)` (`@benzene/clients`) | Stamps the active OpenTelemetry span's W3C `traceparent`/`tracestate` onto `OutboundContext.headers`, so the receiving service can continue the same distributed trace. No-ops when there is no active span. This is the **outbound** counterpart of `@benzene/diagnostics`' inbound `useW3CTraceContext` — same name, opposite direction; import the outbound one from `@benzene/clients`. See [Monitoring & Diagnostics](monitoring.md). |
| `useParallel(pipeline, branches, maxDegreeOfParallelism?)` (`@benzene/clients`) | Fans one topic out to several transports concurrently (see below). |
| `useRetry(pipeline, options)` (`@benzene/resilience`) | Retries the whole pipeline beneath it with exponential backoff. Pass `shouldRetryContext: (ctx) => (ctx.response as IBenzeneResult).status === BenzeneResultStatus.serviceUnavailable` to retry on a specific result status, and/or `shouldRetry` to retry specific errors. Fully generic — the same `RetryMiddleware<TContext>` used everywhere else. See [Resilience](resilience.md). |

There's no dedicated per-call-headers middleware — `sendAsync`'s `headers` parameter already covers
ambient/per-request header state.

Put retry outermost so a failed attempt retries the whole pipeline beneath it, including header
stamping:

```ts
import { useW3CTraceContext } from '@benzene/clients';
import { useRetry } from '@benzene/resilience';

addOutboundRouting(services, (routing) =>
  routing.route('order:create', (pipeline) => {
    useRetry(pipeline, { numberOfRetries: 3 });
    useW3CTraceContext(pipeline);
    pipeline.useService(SendToOrdersService); // your transport middleware
  }));
```

### Parallel fan-out: `useParallel`

`useParallel` sends the message to every named branch concurrently rather than one after another —
use it to fan a single topic out to several transports at once. The send succeeds only if **every**
branch succeeds; otherwise the result is a single failure whose errors name each failed transport
(all-must-succeed). It is a terminal send step — it does not continue to any middleware added after it.

```ts
import { useParallel } from '@benzene/clients';

addOutboundRouting(services, (routing) =>
  routing.route('order:created', (pipeline) =>
    useParallel(pipeline, [
      { name: 'sqs', configure: (b) => b.useService(SendToOrdersQueue) },
      { name: 'sns', configure: (b) => b.useService(PublishOrderCreated) },
    ])));
```

`maxDegreeOfParallelism` caps how many branches send at once; `undefined` or `<= 0` is unbounded.
(`useParallel` ports C#'s `params (string, Action)[]` as an explicit `branches` array of
`{ name, configure }`.)

### Writing a custom outbound middleware

Any `IMiddleware<OutboundContext>` works — no special interface beyond the one every other Benzene
middleware implements:

```ts
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { OutboundContext } from '@benzene/clients';

export class TenantHeaderMiddleware implements IMiddleware<OutboundContext> {
  static readonly inject = [ITenantContext] as const;
  constructor(private readonly tenantContext: ITenantContext) {}

  readonly name = 'TenantHeaderMiddleware';

  handleAsync(context: OutboundContext, next: NextFunc): Promise<void> {
    context.headers['x-tenant-id'] = this.tenantContext.tenantId;
    return next();
  }
}
```

Add it with `pipeline.useService(TenantHeaderMiddleware)`, in whatever order you like alongside the
built-in middleware.

## HTTP

Package: `@benzene/clients-http`. HTTP is the concrete outbound transport that ships today. It plugs
into the **message-sender** path (`out(...)` from `@benzene/core-messages`), converting a
message-shaped client context into an HTTP call over the Node global `fetch`:

```ts
import { out } from '@benzene/core-messages';
import { useHttpClientToSend } from '@benzene/clients-http';

out(builder, (senders) =>
  senders.createSenderWithResponse<CreateOrder, OrderCreated>((client) =>
    useHttpClientToSend<CreateOrder, OrderCreated>(client, 'POST', 'https://orders.internal/api/orders')));
```

Then resolve an `IMessageSender<CreateOrder, OrderCreated>` and call `sendMessageAsync`; the response
body is deserialized and the HTTP status code mapped onto an `IBenzeneResult` (200 → `ok`, 404 →
`not-found`, 503 → `service-unavailable`, …). The three builder helpers (all free functions taking the
pipeline builder first):

- `useHttpClientToSend<TReq, TRes>(app, verb, path, fetchFn?)` — converts the client pipeline into an
  HTTP send for the given verb+path, running the default terminal HTTP-client middleware inside. This is
  the one-call form most services use.
- `useHttp<TReq, TRes>(app, verb, path, action)` — same conversion, but you configure the inner HTTP
  pipeline yourself (e.g. to insert middleware between the conversion and the call).
- `useHttpClient(app, fetchFn?)` — adds just the terminal `HttpClientMiddleware` to an already
  HTTP-shaped (`HttpSendMessageContext`) pipeline.

`HttpContextConverter` serializes the request message as a JSON body and copies every request header
onto the outgoing `HttpRequestMessage.headers`; `HttpClientMiddleware` then performs the call.

> **HttpClient → fetch.** .NET injects an `HttpClient` and calls `SendAsync`. Node has no `HttpClient`,
> so the port injects a `fetch`-like function instead — defaulting to the Node global `fetch`, but
> accepting an injected one (`fetchFn`) so tests can stub the transport:
> `type FetchLike = (request: HttpRequestMessage) => Promise<Response>`.

## AWS Lambda

Package: `@benzene/clients-aws-lambda`. `AwsLambdaClient` (an `IAwsLambdaClient`) invokes a named
Lambda function directly via `@aws-sdk/client-lambda`, serializing the request and deserializing the
response payload as JSON:

```ts
import { InvocationType, LambdaClient } from '@aws-sdk/client-lambda';
import { AwsLambdaClient } from '@benzene/clients-aws-lambda';

const client = new AwsLambdaClient(new LambdaClient({}));

// Fire-and-forget (returns undefined):
await client.sendMessageAsync<CreateOrder, void>(request, 'orders-service', InvocationType.Event);

// Request/response (awaits and deserializes the function's response):
const response = await client.sendMessageAsync<CreateOrder, OrderCreated>(
  request, 'orders-service', InvocationType.RequestResponse);
```

You choose the invocation type explicitly (`Event` = fire-and-forget, `RequestResponse` = await the
result). A `RequestResponse` invoke where the function threw returns HTTP 200 with a `FunctionError`
set and an error object as the payload; the client surfaces that as an `AwsLambdaFunctionErrorException`
(naming the function, the error type, and the error payload) rather than mis-deserializing the error
object into `TResponse`. `BenzeneMessageClientRequest` is the standard Benzene message envelope
(`{ topic, headers, body }`); `LocalAwsLambdaClientFactory.create(profileName)` builds a
profile-authenticated `LambdaClient` for local development.

> **Deferred.** The high-level `AwsLambdaBenzeneMessageClient` (whose `TResponse === Void`
> fire-and-forget branch has no runtime equivalent under TypeScript's generic erasure) and its outbound
> route extension (`.useAwsLambda`) are not yet ported — see the [README package table](../README.md).
> The `AwsLambdaHealthCheck` reachability check *is* ported (its `HealthCheckMode.Active` invoke path,
> which needs that high-level client, is not). The Kafka and EventBridge outbound clients are ported now
> (`@benzene/kafka-core`'s `KafkaBenzeneMessageClient` / `useKafkaSend`, and
> `@benzene/clients-aws-eventbridge`'s `useEventBridge`); the gRPC outbound client is not ported yet.

## In-process

Package: `@benzene/clients-in-process`. Not a wire transport at all — dispatches an outbound send
straight to a handler registered in the *same runtime*, in the shared `BenzeneMessage` envelope every
transport uses, without going over any wire (no SQS/SNS/HTTP/socket, not even loopback). It exists
for the case where functionality that used to live in a different service has been moved into the
caller's own service, and the topic that used to be sent over a real transport now has no reason to
leave the process — see the cross-language [modular monolith
pattern](https://github.com/daniellepelley/Benzene/blob/main/docs/patterns/modular-monolith.md) for
the shape this is written toward: many in-process modules, each with its own pipeline, extracted to
real services one route at a time.

```ts
import { addInProcessMessaging, useInProcess } from '@benzene/clients-in-process';

// One or more named pipelines, each with its own handlers:
addInProcessMessaging(services, (registry) => registry
  .add('billing', (pipeline) => useMessageHandlers(pipeline, ChargeCardHandler))
  .add('shipping', (pipeline) => useMessageHandlers(pipeline, ReserveStockHandler)));

addOutboundRouting(services, (routing) => routing
  .route('billing:charge', (pipeline) => useInProcess(pipeline, 'billing'))
  .route('shipping:reserve', (pipeline) => useInProcess(pipeline, 'shipping')));
```

A single unnamed pipeline is sugar: `addInProcessMessaging(services, (registry) =>
registry.add((pipeline) => useMessageHandlers(pipeline, OrderCreatedHandler)))` with
`useInProcess(pipeline)` (no name) to route to it. `addInProcessMessaging(...)` may only be called
**once** per container — register every module inside that one call; a second call throws
`InProcessMessagingAlreadyRegisteredException` rather than silently shadowing the first.

`useInProcessFanOut(pipeline, ...targets)` dispatches one send to several named pipelines
concurrently (the in-monolith equivalent of one SNS topic fanning out to several subscribers). Each
target is an `InProcessFanOutTarget(pipelineName, topic)` pair, **not just a pipeline name** — every
named pipeline shares the same underlying handler registration for the whole container (Benzene's
(topic, version) → at most one handler rule is process-wide, not per pipeline), so two targets
reacting to what is conceptually one event must each dispatch under a topic of their own:

```ts
routing.route('order:created', (pipeline) => useInProcessFanOut(
  pipeline,
  new InProcessFanOutTarget('billing', 'billing:order-created'),
  new InProcessFanOutTarget('shipping', 'shipping:order-created')));
```

Each target's failure (thrown or a non-success status) is isolated — logged, but does not fail the
other targets or the caller, matching what a real SNS publish does (accepted once published, no
visibility into subscriber outcomes). There is no in-process DLQ: a failed target's message is
genuinely lost unless its own handler retries internally.

> **Boot-time route validation** is ported: a route naming a pipeline nothing registered fails start-up
> (`InProcessRouteStartUpCheck` → `MissingInProcessPipelineException`) when a host boots through its
> `StartUpRunner`, rather than surfacing as an `InProcessPipelineNotFoundException` at first send. It runs
> under the shared start-up-check switch — `addBenzeneStartUpChecks(container, BenzeneStartUpCheckMode.Advisory)`
> logs instead of failing, `.Disabled` turns every check off.
>
> **Typed responses** are ported for the single-target `useInProcess(name)`: it returns the dispatched
> handler's real, typed response — `sendAsync<TRequest, TResponse>` deserializes the response envelope's body
> into `TResponse` (structurally; see the [Erasure note](#wiring-routes-outboundroutingbuilder) above).
> `useInProcessFanOut` is a broadcast to several targets, so it stays `VoidResult`, as does every
> fire-and-forget transport (`useSqs`/`useSns`) that has no response body to type.

## Lower-level: the `IBenzeneMessageClient` decorator suite

Alongside outbound routing, `@benzene/clients` ports the decorator-based client model — a
transport-agnostic client you resolve and call directly, useful for one-off cases where you don't want
a topic-keyed route table:

```ts
export interface IBenzeneMessageClient {
  sendMessageAsync<TRequest, TResponse>(
    request: IBenzeneClientRequest<TRequest>,
  ): Promise<IBenzeneResultOf<TResponse>>;
  dispose(): void;
}
```

`sendMessageAsync` / `sendMessageNoResponseAsync` (`@benzene/clients`) are free-function helpers that
build the `IBenzeneClientRequest` for you from a topic and message. `ClientBuilder` composes a decorated
client: a base builder produces the innermost client, and each decorator wraps it. The two ported
decorators are added by free functions:

- `withRetry(builder, numberOfRetries)` — wraps the client in `RetryBenzeneMessageClient`, which by
  default retries results whose status is `service-unavailable` or `too-many-requests` (transient
  conditions where the request was not processed). `timeout` is deliberately **not** retried by default
  (a timed-out operation may have been applied); opt in via a `shouldRetry` predicate.
- `withCorrelationId(builder)` — wraps the client in `CorrelationIdBenzeneMessageClient`, stamping the
  current `ICorrelationId.get()` value onto every outgoing request's headers (default key
  `correlationId`). See [Correlation IDs](correlation-ids.md).

```ts
import { ClientBuilder, withRetry, withCorrelationId } from '@benzene/clients';

const builder = new ClientBuilder((resolver) => new MyBaseClient(resolver));
withCorrelationId(builder);
withRetry(builder, 3); // added last → outermost: retries the correlation-stamped send
```

`ClientsBuilder` / `SingleClientsBuilder` register these clients for DI, and `ClientMessageSender`
adapts an `IBenzeneMessageClient` behind the generic `IMessageSender<TRequest, TResponse>` port.

## Sending in bulk: `IBenzeneBatchMessageClient`

When you have many messages for one destination, the batch clients send them with the provider's native
*batch* primitive — one call per chunk instead of one per message:

```ts
export interface IBenzeneBatchMessageClient {
  sendBatchAsync<TRequest>(requests: readonly IBenzeneClientRequest<TRequest>[]): Promise<BatchSendResult>;
}
```

Ported for six transports — `SqsBatchMessageClient` (SQS `SendMessageBatch`), `SnsBatchMessageClient`
(SNS `PublishBatch`), `EventBridgeBatchMessageClient` (`PutEvents`), `ServiceBusBatchMessageClient`,
`EventHubBatchMessageClient`, and `EventGridBatchMessageClient`. Each builds every entry with the **same**
`Outbound*ContextConverter` the single-send path uses, so a batched message is byte-for-byte what
`useSqs`/`useSns`/… would have sent.

Batch sending is request-only (there is no typed response, so it isn't affected by the response-type note
in [Overview](#overview)). The result reports **only which entries failed**, by their index in your
collection, so you retry exactly those:

```ts
import { SqsBatchMessageClient } from '@benzene/clients-aws-sqs';

const batch = new SqsBatchMessageClient(sqsClient, queueUrl);
const result = await batch.sendBatchAsync(
  orders.map((o) => ({ topic: 'orders:create', message: o, headers: {} })),
);
if (!result.allSucceeded) {
  const retry = result.failures.map((f) => orders[f.index]);
  // …resend just `retry`
}
```

Failure granularity follows each provider: SQS/SNS report per-entry `Failed` lists and EventBridge a
positional response; Service Bus / Event Hub / Event Grid sends are atomic, so a batch-level throw fails
every message in that batch. The still-deferred piece is the *generic-context* standalone client per
transport — blocked on the same runtime type-erasure as typed outbound responses.

## Health checks: contract drift

Package: `@benzene/clients-health-checks`. `ClientHealthCheck` is a consumer-side check that probes a
downstream provider via its generated client (`IHasHealthCheck`) and reports both whether the provider
is reachable and whether its message contract has **drifted** from the one this client was generated
against. Register it on the contracts diagnostic topic — never a liveness/readiness probe, since it
calls a downstream service:

```ts
import { addContractCheck } from '@benzene/clients-health-checks';

addContractCheck(healthChecks, 'orders-service', IOrdersServiceClient);
```

Its outcomes track the **contract** relationship, not the provider's transient internal health:
reachable + matching contract is `ok`, reachable + drifted is `warning` (degraded-but-not-fatal, does
not flip the aggregate `isHealthy`), and only an unreachable provider is `failed`.
`addContractCheckInstance(builder, serviceName, client)` registers against an explicit client instance
instead of resolving one from DI. See [Health Checks](health-checks.md).

## See Also

- [Message Handlers](message-handlers.md) — the topic-addressed handlers an outbound send targets
- [Message Results](message-result.md) — the `IBenzeneResultOf<T>` a send returns
- [Middleware](middleware.md) — the pipeline mechanism outbound routes are built on
- [Resilience](resilience.md) — `useRetry` retry-with-backoff around a pipeline stage
- [Correlation IDs](correlation-ids.md) — propagating a correlation id onto outbound calls
- [Monitoring & Diagnostics](monitoring.md) — the inbound counterpart of outbound W3C trace context
- [Health Checks](health-checks.md) — where the contract-drift check is registered

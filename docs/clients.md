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

> **Port status.** The .NET package ships transport route extensions (`.useSqs`, `.useSns`,
> `.useServiceBus`, `.useEventHub`, …) that plug a specific broker into an outbound route. Those are
> **not ported yet** — an outbound route's actual send is currently whatever `IMiddleware<OutboundContext>`
> you add to it (custom middleware, or the parallel/trace-context helpers below). The one concrete
> outbound transport that ships today is **HTTP**, via `@benzene/client-http` on the message-sender
> path (see [HTTP](#http)). A low-level **AWS Lambda invoke** client also ships (see
> [AWS Lambda](#aws-lambda)). See the [repository README package table](../README.md) for exactly
> what's ported.

## Installation

Install the core client package; add the HTTP and/or AWS Lambda packages as needed:

| Package | What it adds |
|---|---|
| `@benzene/clients` | `IBenzeneMessageSender`, `OutboundContext`, `OutboundRoutingBuilder` / `addOutboundRouting`, the parallel fan-out (`useParallel`) and outbound W3C trace-context (`useW3CTraceContext`) middleware, and the lower-level `IBenzeneMessageClient` decorator suite (`ClientBuilder`, `withRetry`, `withCorrelationId`, `sendMessageAsync`). |
| `@benzene/client-http` | Outbound HTTP building blocks over the Node `fetch` API — `useHttp` / `useHttpClient` / `useHttpClientToSend`, `HttpContextConverter`, `HttpClientMiddleware`. |
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

The terminal middleware of a route is expected to perform the send and set an `IBenzeneResult` on
`context.response`; `sendAsync` reads it back. If a route produces no `IBenzeneResult`,
`sendAsync` throws `OutboundResponseTypeMismatchException`.

> **Erasure note.** The .NET sender also throws `OutboundResponseTypeMismatchException` when the route
> produced an `IBenzeneResult<T>` of a *different* `T` than the caller's `TResponse`. TypeScript erases
> `TResponse`, so the port can only verify the route produced *an* `IBenzeneResult`, then returns it typed
> as requested — the finer mismatch is undetectable. Because a no-response handler resolves to a
> `VoidResult`, route a send-only topic through `sendAsync<TRequest, VoidResult>`.

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

Package: `@benzene/client-http`. HTTP is the concrete outbound transport that ships today. It plugs
into the **message-sender** path (`out(...)` from `@benzene/core-messages`), converting a
message-shaped client context into an HTTP call over the Node global `fetch`:

```ts
import { out } from '@benzene/core-messages';
import { useHttpClientToSend } from '@benzene/client-http';

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

# Getting Started: Benzene over gRPC

Benzene can expose your message handlers as the implementation of a gRPC service, and call other gRPC
services back through the same transport-agnostic client surface you use everywhere else. On the server
side, `@benzenejs/grpc` bridges a [`@grpc/grpc-js`](https://github.com/grpc/grpc-node) `Server` into a
Benzene middleware pipeline, routing calls of all four RPC shapes — unary, server-streaming,
client-streaming, and bidirectional — to the handler whose topic matches. On the client side,
`@benzenejs/grpc-client` sends unary calls out through that same pipeline model. Both sides share a
Benzene-result ↔ gRPC-status mapping, so a handler's `BenzeneResult` status becomes a gRPC `StatusCode`
(and a `benzene-status` trailer) on the way out, and is recovered on the way back in.

If you're brand new to Benzene, read [Getting Started](getting-started.md) first — it builds the same
kind of service locally on Express in about five minutes. The message handler you write there runs
unchanged over gRPC; only the entry point differs, and that's what this guide covers.

> **TypeScript port.** This is the TypeScript port of [Benzene](https://github.com/daniellepelley/benzene).
> Because Node has no ASP.NET Core, the .NET package's `BenzeneInterceptor` and `Benzene.Grpc.AspNet`
> hosting glue have no analog here: the `@grpc/grpc-js` `Server` *is* the host, and a single
> `useGrpc(...)` bridge replaces both — you register the bridge's handlers on the server directly. A few
> pieces are deliberately **not** ported: the gRPC health check / reflection services, rich
> `google.rpc.Status` error details (the flat `benzene-status` trailer *is* ported), and — on the
> **client** — non-unary streaming calls. See each package's `index.ts` "SCOPE" note for the full
> rationale.

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and npm
- Familiarity with [gRPC on Node](https://grpc.io/docs/languages/node/) and protobuf service
  definitions — this guide assumes you already know how a `.proto`, a generated/loaded
  `ServiceDefinition`, and `@grpc/grpc-js`'s `Server` normally fit together, and focuses on where
  Benzene slots in.

## 1. Create the project

```bash
mkdir orders-grpc && cd orders-grpc
npm init -y
npm pkg set type=module
```

Setting `type=module` makes this an ES-module project, which Benzene's packages require.

## 2. Install the packages

```bash
npm install @benzenejs/grpc @benzenejs/core-message-handlers @benzenejs/results @grpc/grpc-js
# add the client only if this service also calls other gRPC services:
npm install @benzenejs/grpc-client @benzenejs/clients
```

`@benzenejs/grpc` is the server bridge; `@grpc/grpc-js` is the gRPC runtime it wires into (a peer you
supply). `@benzenejs/core-message-handlers` provides the `@message` decorator and `useMessageHandlers`,
and `@benzenejs/results` provides `BenzeneResult`. Add `@benzenejs/grpc-client` and `@benzenejs/clients` only
if this service is also a gRPC *caller* (see [step 7](#7-calling-other-grpc-services)).

## The core idea in 30 seconds

Benzene separates *what your service does* from *how it's invoked*:

- A **message handler** contains your logic. It receives a typed request, returns a typed
  [result](message-result.md), and knows nothing about gRPC.
- Each handler is mapped to a **topic** — a stable string like `order:place` — via the `@message`
  decorator, and to a **full gRPC method path** (`/<package>.<Service>/<Method>`) via `@grpcMethod`.
- The `useGrpc(...)` bridge builds a middleware pipeline over those handlers and hands you a
  grpc-js handler per RPC shape, which you register on the `@grpc/grpc-js` `Server`.

`@grpcMethod` only annotates the class — it does **not** register it. Registration comes from `@message`
(which self-registers in the handler registry); `@grpcMethod`'s path is then read off each handler to
build the method-path → topic route table. So the two decorators always travel together.

## 3. Define your `.proto`

Nothing Benzene-specific here — this is an ordinary gRPC service:

```proto
syntax = "proto3";
package orders;

service Orders {
  rpc PlaceOrder (PlaceOrderRequest) returns (OrderConfirmation);
}

message PlaceOrderRequest { string customer_id = 1; }
message OrderConfirmation { string order_id = 1; }
```

Load it into a grpc-js `ServiceDefinition` the standard way (for example with
[`@grpc/proto-loader`](https://github.com/grpc/grpc-node/tree/master/packages/proto-loader)); that
`ServiceDefinition` is what you pass to `server.addService(...)` in [step 5](#5-wire-up-the-grpc-server).
Benzene doesn't replace this step — it plugs handlers *into* it.

## 4. Write a message handler

This is where your logic lives — the file you'd carry over verbatim if you later hosted it on Express or
Lambda. Two decorators do the wiring:

```ts
// src/handlers.ts
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { message } from '@benzenejs/core-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import { grpcMethod } from '@benzenejs/grpc';

// Payloads are classes, not interfaces: the runtime recovers the erased request type from its
// constructor (for topic/schema keying), which an interface can't provide.
export class PlaceOrder {
  customerId = '';
}

export class OrderConfirmation {
  orderId = '';
}

@grpcMethod('/orders.Orders/PlaceOrder')
@message('order:place', { requestType: PlaceOrder, responseType: OrderConfirmation })
export class PlaceOrderHandler implements IMessageHandler<PlaceOrder, OrderConfirmation> {
  handleAsync(request: PlaceOrder): Promise<IBenzeneResultOf<OrderConfirmation>> {
    const confirmation = new OrderConfirmation();
    confirmation.orderId = `order-${request.customerId || 'anon'}`;
    return Promise.resolve(BenzeneResult.ok(confirmation));
  }
}
```

- `@message('order:place', …)` maps the handler to its topic — the identifier every Benzene transport
  routes by. The `requestType`/`responseType` give the runtime the concrete classes it needs (TypeScript
  erases generics, so they can't be inferred).
- `@grpcMethod('/orders.Orders/PlaceOrder')` records the **full gRPC method path** — exactly as it
  appears in the service definition — that this handler serves. This is what the bridge matches an
  incoming call against to find the topic.

`BenzeneResult.ok(...)` is the success case; the result carries success/failure status alongside the
payload — see [Message Result](message-result.md).

## 5. Wire up the gRPC server

`useGrpc(configure)` builds the Benzene pipeline (registering the gRPC + baseline services on its own),
tags the transport `"grpc"`, and returns a `GrpcBenzeneBridge`. The bridge's `to*Handler(methodPath)`
methods produce grpc-js handlers you drop straight into `server.addService(...)` — one per RPC shape:

```ts
// src/index.ts
import { Server, ServerCredentials } from '@grpc/grpc-js';
import { useMessageHandlers } from '@benzenejs/core-message-handlers';
import { useGrpc } from '@benzenejs/grpc';
import { PlaceOrderHandler } from './handlers.js';
import { OrdersService } from './generated/orders.js'; // your loaded ServiceDefinition

const bridge = useGrpc((pipeline) => useMessageHandlers(pipeline, PlaceOrderHandler));

const server = new Server();
server.addService(OrdersService, {
  placeOrder: bridge.toUnaryHandler('/orders.Orders/PlaceOrder'),
});

server.bindAsync('0.0.0.0:50051', ServerCredentials.createInsecure(), () => {
  console.log('gRPC server listening on :50051');
});
```

What each step does:

- `useGrpc((pipeline) => useMessageHandlers(pipeline, PlaceOrderHandler))` builds the pipeline over every
  handler class you pass to `useMessageHandlers`. Pass all of them here.
- `bridge.toUnaryHandler('/orders.Orders/PlaceOrder')` returns a `@grpc/grpc-js` unary handler bound to
  that method path. Register it under the service definition's method key (grpc-js lower-camel-cases the
  method name, so `PlaceOrder` → `placeOrder`).
- The method path argument is optional — `bridge.toUnaryHandler()` with no argument reads the path from
  the incoming call's own `getPath()`, so one bridge handler can serve a whole service if you prefer.

On a match, the bridge runs the pipeline and invokes the grpc-js callback with the response plus a
`benzene-status` trailer. If **no** Benzene handler owns the called method, the bridge fails the call with
gRPC `UNIMPLEMENTED` — the Node analog of .NET's interceptor falling through to a native service method.

## 6. Streaming handlers

A streaming handler is an ordinary message handler whose request and/or response type is
`AsyncIterable<T>`. Register it with the matching `to*Handler` for its shape:

```ts
// server-streaming: one request in, a stream of responses out
@grpcMethod('/orders.Orders/Subscribe')
@message('order:subscribe', { requestType: SubscribeRequest })
export class SubscribeHandler
  implements IMessageHandler<SubscribeRequest, AsyncIterable<OrderEvent>>
{
  handleAsync(request: SubscribeRequest): Promise<IBenzeneResultOf<AsyncIterable<OrderEvent>>> {
    return Promise.resolve(BenzeneResult.ok(produce(request)));
  }
}
```

```ts
server.addService(OrdersService, {
  placeOrder: bridge.toUnaryHandler('/orders.Orders/PlaceOrder'),
  subscribe: bridge.toServerStreamingHandler('/orders.Orders/Subscribe'),
  upload:    bridge.toClientStreamingHandler('/orders.Orders/Upload'),   // AsyncIterable<T> in, T out
  chat:      bridge.toBidiStreamingHandler('/orders.Orders/Chat'),       // AsyncIterable<T> both ways
});
```

- **Client-streaming** handlers declare `IMessageHandler<AsyncIterable<TItem>, TResponse>` and
  `for await` over the request stream.
- **Bidirectional** handlers declare `IMessageHandler<AsyncIterable<TItem>, AsyncIterable<TItem>>` and
  return an async generator.

One pipeline invocation happens per RPC call, not per stream item. For the response-writing shapes
(server-/bidi-streaming) the bridge writes each yielded item to the call, then `end()`s it with the
`benzene-status` trailer on success; on a non-OK status it emits a gRPC error on the call.

## Status mapping

Every handler result's `BenzeneResult` status is mapped to a gRPC `StatusCode` and also written verbatim
onto a `benzene-status` response trailer. The `DefaultGrpcStatusCodeMapper` table:

| `BenzeneResultStatus` | gRPC `status` |
|---|---|
| `ok`, `ignored`, `created`, `accepted`, `updated`, `deleted` | `OK` |
| `badRequest`, `validationError` | `INVALID_ARGUMENT` |
| `unauthorized` | `UNAUTHENTICATED` |
| `forbidden` | `PERMISSION_DENIED` |
| `notFound` | `NOT_FOUND` |
| `conflict` | `ALREADY_EXISTS` |
| `notImplemented` | `UNIMPLEMENTED` |
| `serviceUnavailable` | `UNAVAILABLE` |
| `tooManyRequests` | `RESOURCE_EXHAUSTED` |
| `timeout` | `DEADLINE_EXCEEDED` |
| `unexpectedError` / anything unrecognized | `INTERNAL` |

A non-OK status fails the call with that code; the `details` carry the joined result errors. Because the
`benzene-status` trailer is always added, a Benzene *client* can recover the original, more specific
status even where several statuses collapse onto the same code (e.g. `created`/`accepted`/`updated` all
map to `OK`) — that's what the client's reverse mapper prefers (see the next step).

## 7. Calling other gRPC services

`@benzenejs/grpc-client`'s `GrpcBenzeneMessageClient` is an `IBenzeneMessageClient` that sends unary calls
out through a Benzene pipeline over a `@grpc/grpc-js` `Client` you own. Register a topic → method route
for each outbound call, then send by topic:

```ts
import { Client, ChannelCredentials } from '@grpc/grpc-js';
import { sendMessageAsync } from '@benzenejs/clients';
import { GrpcBenzeneMessageClient, GrpcClientRouteRegistry } from '@benzenejs/grpc-client';

const registry = new GrpcClientRouteRegistry();
registry.add('order:place', '/orders.Orders/PlaceOrder');

const grpcClient = new Client('localhost:50051', ChannelCredentials.createInsecure());
const client = new GrpcBenzeneMessageClient(grpcClient, registry);

const result = await sendMessageAsync(client, 'order:place', { customerId: 'acme' });
if (result.isSuccessful) {
  console.log(result.payload); // { orderId: 'order-acme' }
} else {
  console.error(result.status, result.errors);
}
```

- `registry.add(topic, fullMethodName)` maps a topic onto a fully-qualified gRPC method path. The wire
  codec defaults to a JSON/structural marshaller; pass an explicit `marshaller` to `add(...)` to talk to
  a protobuf service.
- The **caller owns the `Client`** — the port takes the grpc-js `Client` explicitly (matching how the
  other outbound clients take their own `SQSClient`/`Producer`/`Channel`), and never creates or disposes
  a channel for you.
- On success `result.status` is the mapped Benzene status (or the exact `benzene-status` trailer value if
  the server sent one); on a non-OK call it's the reverse-mapped status (`NOT_FOUND` → `notFound`, etc.),
  with the gRPC `details` surfaced in `result.errors`. If no route is registered for the topic, the call
  isn't made and the result is `notImplemented`.

### DI wiring

To resolve the client from a container instead of constructing it by hand, use `addGrpcClient`:

```ts
import { addGrpcClient } from '@benzenejs/grpc-client';
import { IBenzeneMessageClient } from '@benzenejs/clients';

addGrpcClient(container, grpcClient, (registry) => {
  registry.add('order:place', '/orders.Orders/PlaceOrder');
});
// later: resolver.getService(IBenzeneMessageClient)
```

## 8. Testing

A Benzene message handler is a plain class — the fastest test constructs it and calls `handleAsync`
directly, with no gRPC in the picture:

```ts
import { describe, expect, it } from 'vitest';
import { PlaceOrderHandler, PlaceOrder } from '../src/handlers.js';

describe('PlaceOrderHandler', () => {
  it('confirms the order', async () => {
    const request = new PlaceOrder();
    request.customerId = 'acme';

    const result = await new PlaceOrderHandler().handleAsync(request);

    expect(result.isSuccessful).toBe(true);
    expect(result.payload.orderId).toBe('order-acme');
  });
});
```

To exercise the whole pipeline, `useGrpc(...)` returns the same bridge you ship, so you can invoke a
`to*Handler` against a stand-in grpc-js call object and assert on the response and the `benzene-status`
trailer. On the client side, `new GrpcBenzeneMessageClient(fakeClient, registry)` accepts any object with
a `makeUnaryRequest` method, so a fake grpc-js `Client` lets you drive `sendMessageAsync` end-to-end
without a live connection. See the package tests under `test/Benzene.Core.Test/Grpc/` for worked
examples of both.

## See Also

- [`examples/grpc`](../examples/grpc) — a runnable gRPC greeter across all four RPC shapes, with a client
- [Getting Started](getting-started.md) — build the same handler locally on Express first
- [Getting Started on AWS Lambda](getting-started-aws.md) — the same handlers, hosted on Lambda
- [Message Handlers](message-handlers.md) — the handler contract, topics, and `@message`
- [Message Result](message-result.md) — `BenzeneResult.ok`/`.created` and the result envelope
- [Middleware](middleware.md) — what else composes into the pipeline
- [Correlation IDs](correlation-ids.md) — trace requests across services

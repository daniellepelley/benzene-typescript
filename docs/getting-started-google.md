# Getting Started: Benzene on Google Cloud Functions

Benzene runs on **Google Cloud Functions (Gen2)**, serving both HTTP-triggered and Pub/Sub-triggered
functions from a single set of message handlers. This guide starts from an empty folder and ends with an
HTTP function answering `POST /orders`, then adds a Pub/Sub function so you can see the same handlers
reached over a second trigger without rewriting a line of your logic.

If you're brand new to Benzene, read [Getting Started](getting-started.md) first — it builds the same
kind of service locally on Express in about five minutes. The message handler you write there runs
unchanged on Cloud Functions; only the entry point differs, and that's what this guide covers.

> **TypeScript port.** This is the TypeScript port of [Benzene](https://github.com/daniellepelley/benzene).
> It mirrors the .NET library's shape as closely as the language allows; where the two differ, the README's
> [Porting conventions](../README.md#porting-conventions) explain why. Two adaptations matter here. First,
> the .NET **production host** `GoogleCloudFunctionHost<TStartUp>` (and its Pub/Sub sibling) **is ported**, and
> it now boots the SAME canonical `BenzeneStartUp` (from `@benzene/abstractions-middleware`) that
> `AwsLambdaHost` / `AzureFunctionHost` boot — you write one `StartUp` and select Google inside `configure`
> with `useGoogleCloud(app, g => …)`, exactly where AWS writes `useAwsLambda` and Azure writes
> `useAzureFunctions`. (The legacy per-cloud `GoogleCloudFunctionStartUp` / `GooglePubSubFunctionStartUp`
> contracts still work and are accepted by the hosts, but are deprecated in favour of the unified shape.)
> Second, the .NET host *is* the Functions Framework entry point; Node's Functions Framework invokes a
> **registered named handler**, so the TS host instead **exposes** a bound closure (`host.httpFunction` /
> `host.cloudEventFunction`) you register with the framework.

## What you'll build

An HTTP-triggered function that handles `POST /orders`, and a Pub/Sub-triggered function that consumes
messages off a subscription — both driven by the same transport-agnostic handlers.

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and npm
- Any editor
- The [`gcloud` CLI](https://cloud.google.com/sdk/docs/install), authenticated (`gcloud auth login`) with a
  project set (`gcloud config set project <id>`) — only if you want to deploy. Everything up to that point
  runs locally.

## The core idea in 30 seconds

Benzene separates *what your service does* from *how it's invoked*:

- A **message handler** contains your logic. It receives a typed request, returns a typed
  [result](message-result.md), and knows nothing about Cloud Functions, HTTP, or Pub/Sub.
- Each handler is mapped to a **topic** — a stable string like `order:place` — via the `@message`
  decorator, and (for HTTP) to a method and path via `@httpEndpoint`.
- A **transport pipeline** turns an incoming request into a message, routes it to the matching handler by
  topic, and turns the result back into a transport-native response.

On Cloud Functions the pipeline is built by a **startup** (`configureServices` + `configure`) that a host
boots. You register the host's handler with the Functions Framework and point
`gcloud functions deploy --entry-point` at it. The handler itself is identical to the one you'd host on
[Express](getting-started.md) or [AWS Lambda](getting-started-aws.md).

## 1. Create the project

```bash
mkdir orders-gcf && cd orders-gcf
npm init -y
npm pkg set type=module
```

Setting `type=module` makes this an ES-module project, which Benzene's packages require.

## 2. Install the packages

```bash
npm install @benzene/google-cloud-functions-core @benzene/google-cloud-functions-http \
  @benzene/google-cloud-functions-pubsub \
  @benzene/core-message-handlers @benzene/http @benzene/results \
  @benzene/abstractions @benzene/abstractions-message-handlers @benzene/abstractions-middleware \
  @google-cloud/functions-framework
npm install --save-dev typescript
```

`@benzene/google-cloud-functions-core` brings the neutral `useGoogleCloud` selector (the Google counterpart
of `useAwsLambda`/`useAzureFunctions`); `@benzene/google-cloud-functions-http` brings the HTTP host
(`GoogleCloudFunctionHost`) and its `useHttp` wiring; `@benzene/google-cloud-functions-pubsub` brings the
Pub/Sub host (`GooglePubSubFunctionHost`) and `usePubSub`. `@benzene/core-message-handlers` supplies
`addBenzene`, the `@message` decorator, and `useMessageHandlers`; `@benzene/http` adds `@httpEndpoint`;
`@benzene/results` supplies `BenzeneResult`; the `@benzene/abstractions*` packages supply the
`IMessageHandler` / `IBenzeneResultOf` / `IBenzeneServiceContainer` types and the canonical
`BenzeneStartUp` / `IBenzeneApplicationBuilder` / `BenzeneConfiguration` hosting contract.
`@google-cloud/functions-framework` is the Google runtime you register the host with (and the source of its
`Request`/`Response`/`CloudEvent` types).

## 3. Write a message handler

Create `src/handlers.ts`. This is where your logic lives — the file you'd carry over verbatim if you later
moved to Express or Lambda:

```ts
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { BenzeneResult } from '@benzene/results';

// Payloads are classes, not interfaces: the runtime recovers the erased request type from its
// constructor (for topic/schema keying), which an interface can't provide.
export class PlaceOrder {
  name?: string;
}

export class OrderDto {
  id?: string;
  name?: string;
}

@httpEndpoint('POST', '/orders')
@message('order:place', { requestType: PlaceOrder, responseType: OrderDto })
export class PlaceOrderHandler implements IMessageHandler<PlaceOrder, OrderDto> {
  handleAsync(request: PlaceOrder): Promise<IBenzeneResultOf<OrderDto>> {
    return Promise.resolve(BenzeneResult.created<OrderDto>({ id: 'order-1', name: request.name }));
  }
}
```

Two decorators do the wiring:

- `@message('order:place', …)` maps the handler to its topic. Every Benzene transport routes by topic, so
  this identifier stays constant across HTTP and Pub/Sub. The `requestType`/`responseType` give the runtime
  the concrete classes it needs (TypeScript erases generics, so they can't be inferred).
- `@httpEndpoint('POST', '/orders')` maps an HTTP method and path onto that same topic.

`BenzeneResult.created(...)` is the success case that maps to HTTP `201`; use `BenzeneResult.ok(...)` for
`200` and `BenzeneResult.accepted(...)` for `202`. The result carries success/failure status alongside the
payload — see [Message Result](message-result.md).

> **Request binding.** Benzene binds the JSON **request body** onto your request object, so a `POST` with
> `{"name":"acme"}` populates `request.name`. Unlike .NET, the TypeScript port does **not** bind path/query
> segments onto a bodyless request, so this guide uses a `POST` body. Read values a client sends in the body.

## 4. Define the startup and the HTTP entry point

Create `src/http.ts`. The startup is the platform-neutral pair of methods every Benzene host boots from;
only the entry-point registration at the bottom is Google-specific:

```ts
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { BenzeneConfiguration, BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzene/core-message-handlers';
import { useGoogleCloud } from '@benzene/google-cloud-functions-core';
import { GoogleCloudFunctionHost, useHttp } from '@benzene/google-cloud-functions-http';
import * as functions from '@google-cloud/functions-framework';
import { PlaceOrderHandler } from './handlers.js';

export class OrdersStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    // Register your own services here. addBenzene wires the core pipeline.
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useGoogleCloud(app, (g) => useHttp(g, (http) => useMessageHandlers(http, PlaceOrderHandler)));
  }
}

// Build the host once, then register its bound handler with the Functions Framework.
const host = new GoogleCloudFunctionHost(OrdersStartUp);
functions.http('orders', host.httpFunction);
```

What each step does:

- `OrdersStartUp implements BenzeneStartUp` — the SAME canonical contract every cloud boots from.
  `configureServices(services, config)` calls `addBenzene(services)` to register the core message-handler
  pipeline (register your own dependencies here too).
- `configure(app, config)` calls `useGoogleCloud(app, g => …)` to scope the wiring to Google Cloud — the
  exact counterpart of AWS's `useAwsLambda` and Azure's `useAzureFunctions` — and inside it
  `useHttp(g, (http) => …)` inserts the HTTP transport, where `useMessageHandlers(http, PlaceOrderHandler)`
  routes a matched request to its handler. Pass every handler class you want served.
- `new GoogleCloudFunctionHost(OrdersStartUp)` constructs the startup, runs `configureServices`/`configure`,
  and builds the request handler once. `functions.http('orders', host.httpFunction)` registers it under the
  entry-point name `orders`.

> **Register the bound closure — this is the one gotcha.** Always register `host.httpFunction`. It is a
> closure bound to the host, so `this` stays attached. Do **not** register `host.handleAsync` directly —
> passing the method detaches `this` and the function loses its pipeline. `host.httpFunction` avoids that
> trap, the same way `toLambdaHandler` does for AWS.

## 5. Deploy

Compile `src/` to JavaScript (e.g. `npx tsc`) and set your `package.json` `"main"` to the built file that
calls `functions.http(...)`, so the module registers the function when the Functions Framework loads it.
Then deploy with the entry-point name you registered:

```bash
gcloud functions deploy orders \
  --gen2 --runtime nodejs22 --region europe-west2 \
  --source . --entry-point orders \
  --trigger-http --allow-unauthenticated
```

`--entry-point orders` matches the name you passed to `functions.http('orders', …)`; the Functions Framework
does the rest. When it finishes it prints the function URL:

```bash
curl -X POST "$(gcloud functions describe orders --gen2 --region europe-west2 --format 'value(serviceConfig.uri)')/orders" \
  -H "Content-Type: application/json" -d '{"name":"acme"}'
```

```json
{"id":"order-1","name":"acme"}
```

## 6. Add a second trigger: Pub/Sub

The whole point of Benzene is that a handler doesn't care which trigger delivered its message. Add a handler
that reacts to an order being created — the same shape, a different topic, and **no** `@httpEndpoint`, so
it's reached only over Pub/Sub:

```ts
// add to src/handlers.ts
export class OrderCreated {
  id?: string;
  name?: string;
}

export class WarehouseAck {
  accepted?: boolean;
}

@message('order:created', { requestType: OrderCreated, responseType: WarehouseAck })
export class NotifyWarehouseHandler implements IMessageHandler<OrderCreated, WarehouseAck> {
  handleAsync(request: OrderCreated): Promise<IBenzeneResultOf<WarehouseAck>> {
    // ... notify the warehouse
    return Promise.resolve(BenzeneResult.ok<WarehouseAck>({ accepted: true }));
  }
}
```

A Pub/Sub trigger is a different Cloud Functions trigger type from HTTP, so it gets its own startup and host
— but it still uses the same handler classes. Create `src/pubsub.ts`:

```ts
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { BenzeneConfiguration, BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzene/core-message-handlers';
import { useGoogleCloud } from '@benzene/google-cloud-functions-core';
import { GooglePubSubFunctionHost, usePubSub } from '@benzene/google-cloud-functions-pubsub';
import * as functions from '@google-cloud/functions-framework';
import { NotifyWarehouseHandler } from './handlers.js';

export class OrdersPubSubStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useGoogleCloud(app, (g) => usePubSub(g, (pubsub) => useMessageHandlers(pubsub, NotifyWarehouseHandler)));
  }
}

const host = new GooglePubSubFunctionHost(OrdersPubSubStartUp);
functions.cloudEvent('orders-pubsub', host.cloudEventFunction);
```

`usePubSub` mirrors `useHttp`, and `functions.cloudEvent('orders-pubsub', host.cloudEventFunction)` registers
the bound CloudEvent handler (the Pub/Sub analog of `host.httpFunction`). Pub/Sub delivers **exactly one
message per invocation**, and the Benzene topic is read from the message's `"topic"` **attribute** by
default — so `@message('order:created', …)` handles a message published with `topic: order:created`. (Pass a
custom attribute key as the trailing argument to `usePubSub(app, action, configure?, topicAttributeKey)` if
your producer uses a different key.) Delivery is fire-and-consume: there is no response to write back.

Deploy it as a second function pointed at a topic:

```bash
gcloud functions deploy orders-pubsub \
  --gen2 --runtime nodejs22 --region europe-west2 \
  --source . --entry-point orders-pubsub \
  --trigger-topic orders
```

## 7. Test it

Before deploying, exercise both startups in-memory with the same wiring you'll ship, using the test-helper
packages. Boot the **real** startup with `benzeneTestHost(...)` from `@benzene/testing`, override any
dependency with `.withServices(...)`, then finish with the one GCP-specific line —
`buildGoogleCloudFunctionHost(...)` for HTTP or `buildGooglePubSubFunctionHost(...)` for Pub/Sub:

```bash
npm install --save-dev vitest @benzene/testing \
  @benzene/google-cloud-functions-http-testing @benzene/google-cloud-functions-pubsub-testing
```

**HTTP** — build a native request with `asGoogleCloudHttpRequest(httpBuilder(...))`, push it in with
`host.sendHttpAsync(...)`, and assert on the returned response:

```ts
// test/http.test.ts
import { describe, expect, it } from 'vitest';
import { benzeneTestHost, httpBuilder } from '@benzene/testing';
import { asGoogleCloudHttpRequest, buildGoogleCloudFunctionHost } from '@benzene/google-cloud-functions-http-testing';
import { OrdersStartUp } from '../src/http.js'; // export OrdersStartUp to test it

describe('orders (HTTP)', () => {
  it('POST /orders returns a 201 with the mapped body', async () => {
    const host = buildGoogleCloudFunctionHost(benzeneTestHost(OrdersStartUp));

    const request = asGoogleCloudHttpRequest(httpBuilder('POST', '/orders', { name: 'acme' }));
    const response = await host.sendHttpAsync(request);

    expect(response.statusCode).toBe(201); // BenzeneResult.created -> 201
    expect(JSON.parse(response.body)).toMatchObject({ name: 'acme' });
  });
});
```

**Pub/Sub** — build a message with `asPubSubEvent(messageBuilder(topic, body))` (or `PubSubMessageBuilder`)
and push it in with `host.sendPubSubAsync(...)`. Pub/Sub has no response, so assert on **egress** — what the
handler published — through a faked `IBenzeneMessageSender`:

```ts
// test/pubsub.test.ts
import { describe, expect, it } from 'vitest';
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { IBenzeneMessageSender } from '@benzene/clients';
import { addBenzene, useMessageHandlers } from '@benzene/core-message-handlers';
import { BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { benzeneTestHost, FakeBenzeneMessageSender, messageBuilder } from '@benzene/testing';
import { useGoogleCloud } from '@benzene/google-cloud-functions-core';
import { usePubSub } from '@benzene/google-cloud-functions-pubsub';
import { asPubSubEvent, buildGooglePubSubFunctionHost } from '@benzene/google-cloud-functions-pubsub-testing';

// A startup whose handler publishes 'order:created' downstream via IBenzeneMessageSender.
class PublishingStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
  }
  configure(app: IBenzeneApplicationBuilder): void {
    useGoogleCloud(app, (g) => usePubSub(g, (pubsub) => useMessageHandlers(pubsub, /* your handler */)));
  }
}

describe('orders (Pub/Sub)', () => {
  it('consumes a message and publishes downstream', async () => {
    const fake = new FakeBenzeneMessageSender();
    const host = buildGooglePubSubFunctionHost(
      benzeneTestHost(PublishingStartUp).withServices((services) =>
        services.addSingletonInstance(IBenzeneMessageSender, fake),
      ),
    );

    await host.sendPubSubAsync(asPubSubEvent(messageBuilder('order:place', { id: 'abc', name: 'acme' })));

    expect(fake.lastTopic).toBe('order:created');
    expect(fake.lastRequest).toMatchObject({ id: 'abc', name: 'acme' });
  });
});
```

`asPubSubEvent(...)` puts the topic on the `"topic"` attribute and base64-encodes the body, exactly the shape
the transport reads. You can also build the payload directly:

```ts
import { PubSubMessageBuilder } from '@benzene/google-cloud-functions-pubsub-testing';

const data = new PubSubMessageBuilder()
  .withTopic('order:place')
  .withBody({ id: 'xyz', name: 'globex' })
  .build();
await host.sendPubSubAsync(data);
```

See [Testing Benzene](testing-benzene.md) for the full pattern.

## Next steps

- **See the runnable example** — [`examples/google-cloud-functions`](../examples/google-cloud-functions)
  hosts one order domain on Google Cloud Functions, with a component test.
- **Add validation** — reject bad requests with the [Zod, Joi, or Yup adapters](validation.md).
- **Run the same handlers elsewhere** — [AWS Lambda](getting-started-aws.md),
  [Azure Functions](azure-functions.md).
- **Message Handlers** — the handler contract, topics, and `@message`/`@httpEndpoint`: see
  [Message Handlers](message-handlers.md).
- **Message Result** — `BenzeneResult.ok`/`.created`/`.accepted` and the result envelope:
  [Message Result](message-result.md).
```

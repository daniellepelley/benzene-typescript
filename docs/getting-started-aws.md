# Getting Started: Benzene on AWS Lambda

Benzene runs efficiently in AWS Lambda, handling multiple event sources — API Gateway, SQS, SNS,
EventBridge, Kafka, and more — through a single middleware pipeline. This guide starts from an empty
folder and ends with a bundled Lambda function serving API Gateway requests, then adds a second
transport so you can see how one handler works across event sources without changing a line of it.

If you're brand new to Benzene, read [Getting Started](getting-started.md) first — it builds the same
kind of service locally on Express in about five minutes. The message handler you write there runs
unchanged on Lambda; only the entry point differs, and that's what this guide covers.

> **TypeScript port.** This is the TypeScript port of [Benzene](https://github.com/daniellepelley/benzene).
> It mirrors the .NET library's shape as closely as the language allows; where the two differ, the README's
> [Porting conventions](../README.md#porting-conventions) explain why. The .NET **production host adapter**
> `AwsLambdaHost<TStartUp>` (running a canonical `BenzeneStartUp`) **is ported** — you write one `StartUp`
> class and boot it with the one-liner `export const handler = new AwsLambdaHost(StartUp).lambdaHandler`,
> the same composition root the `benzeneTestHost(...)` test harness boots (see
> [Testing Benzene](testing-benzene.md)), so what you test is what deploys. The terse fluent
> `InlineAwsLambdaStartUp` builder remains as an advanced/terse alternative for inline tests and small
> standalone hosts.

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and npm
- Any editor
- An AWS account, with the [AWS CLI](https://aws.amazon.com/cli/) and
  [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
  configured — only if you want to deploy. Everything up to that point runs locally.

## The core idea in 30 seconds

Benzene separates *what your service does* from *how it's invoked*:

- A **message handler** contains your logic. It receives a typed request, returns a typed
  [result](message-result.md), and knows nothing about Lambda, API Gateway, or queues.
- Each handler is mapped to a **topic** — a stable string like `order:place` — via the `@message`
  decorator, and (for HTTP) to a method and path via `@httpEndpoint`.
- A **transport pipeline** turns an incoming Lambda event into a message, routes it to the matching
  handler by topic, and turns the result back into a transport-native response.

On Lambda the transport pipeline is built by an entry point you export as `handler`. The handler
itself is identical to the one you'd host on [Express](getting-started.md) or
[Azure Functions](azure-functions.md). See [Message Handlers](message-handlers.md) and
[Middleware](middleware.md) for the full picture.

## 1. Create the project

```bash
mkdir orders-lambda && cd orders-lambda
npm init -y
npm pkg set type=module
```

Setting `type=module` makes this an ES-module project, which Benzene's packages require — and it's the
shape you want for a modern Lambda bundle.

## 2. Install the packages

```bash
npm install @benzenejs/aws-lambda @benzenejs/http
npm install --save-dev typescript esbuild @types/aws-lambda
```

`@benzenejs/aws-lambda` is the umbrella for building a Lambda service: one install brings in the
middleware pipeline and message-handler infrastructure, the `AwsLambdaHost` production host (and the
`useAwsLambda` selector), the results/handler building blocks, **and** every event-source transport —
`useApiGateway`, `useSqs`, `useSns`, `useEventBridge`, `useKafka`, and the rest — so you don't add a
package per event source (see [Supported event sources](#supported-event-sources)). `@benzenejs/http` adds
the `httpEndpoint` helper for HTTP-shaped handlers. The canonical `BenzeneStartUp` contract lives in
`@benzenejs/abstractions-middleware` (installed transitively). Prefer a narrower dependency set? Install
the individual `@benzenejs/aws-lambda-*` packages instead.

## 3. Write a message handler

Create `src/handlers.ts`. This is where your logic lives — the file you'd carry over verbatim if you
later moved to Express or Azure Functions:

```ts
import { IBenzeneResultOf, IMessageHandler, message, BenzeneResult } from '@benzenejs/aws-lambda';
import { httpEndpoint } from '@benzenejs/http';

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
  so this identifier stays constant across API Gateway, SQS, SNS, and the rest. The
  `requestType`/`responseType` give the runtime the concrete classes it needs (TypeScript erases
  generics, so they can't be inferred).
- `@httpEndpoint('POST', '/orders')` maps an HTTP method and path onto that same topic, so the same
  handler answers both a direct topic-routed message (from SQS/SNS/EventBridge) and an API Gateway
  request.

`BenzeneResult.created(...)` is the success case that maps to HTTP `201`; use `BenzeneResult.ok(...)`
for `200`. The result carries success/failure status alongside the payload — see
[Message Result](message-result.md).

> **Request binding.** Benzene binds the JSON **request body** onto your request object, so a `POST`
> with `{"customerId":"acme"}` populates `request.customerId`. Unlike .NET, the TypeScript port does
> **not** bind path/query segments onto a bodyless request, so this guide uses a `POST` body rather than
> the .NET guide's `GET /hello/{name}`. Read values a client sends in the body.

## 4. Write the composition root and the entry point

Two small files. First `src/startUp.ts` — the composition root, the single place your service is wired.
It implements the canonical `BenzeneStartUp` contract (the same shape on every cloud): `configureServices`
registers the service graph, `configure` wires the transport pipeline(s). Inside `configure` you select
AWS with `useAwsLambda(app, aws => …)`:

```ts
// src/startUp.ts
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneConfiguration, BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene, useAwsLambda, useApiGateway, useMessageHandlers } from '@benzenejs/aws-lambda';
import { PlaceOrderHandler } from './handlers.js';

export class StartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    // Register your own services here — a component test can override any of them.
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useAwsLambda(app, (aws) => useApiGateway(aws, (api) => useMessageHandlers(api, PlaceOrderHandler)));
  }
}
```

Then `src/handler.ts` — the only file that knows it's running on Lambda, a single line:

```ts
// src/handler.ts
import { AwsLambdaHost } from '@benzenejs/aws-lambda';
import { StartUp } from './startUp.js';

export const handler = new AwsLambdaHost(StartUp).lambdaHandler;
```

What each piece does:

- `StartUp implements BenzeneStartUp` — `configureServices(services, config)` registers your service
  graph (`addBenzene` pulls in Benzene's baseline; `useMessageHandlers` also ensures it idempotently),
  and `configure(app, config)` wires the pipeline. `useAwsLambda(app, aws => …)` scopes the wiring to
  AWS; inside it `useApiGateway(aws, (api) => …)` inserts the API Gateway transport and
  `useMessageHandlers(api, PlaceOrderHandler)` routes a matched request to its handler. Pass every
  handler class you want served.
- `new AwsLambdaHost(StartUp)` builds the pipeline once on cold start from that `StartUp` — the same
  composition root a component test boots via `benzeneTestHost(StartUp).buildAwsLambdaHost()` — and
  `.lambdaHandler` is the correctly-bound function AWS calls on each invocation.

> **Export the bound handler — this is the one gotcha.** Always write:
>
> ```ts
> export const handler = new AwsLambdaHost(StartUp).lambdaHandler;
> ```
>
> **Do not** write `export const handler = host.functionHandlerAsync`. It compiles — the method is
> assignable to the handler type — but assigning the method detaches `this`, so the host loses its
> pipeline and the function crashes at the first invocation. `.lambdaHandler` closes over the host and
> keeps `this` bound; use it every time.
>
> **Advanced/terse alternative.** For an inline test or a tiny standalone host you can skip the `StartUp`
> class and use the fluent `InlineAwsLambdaStartUp` builder directly:
> `const entryPoint = new InlineAwsLambdaStartUp().configure(app => useApiGateway(app, …)).build();`
> then `export const handler = toLambdaHandler(entryPoint);`. The `AwsLambdaHost(StartUp)` one-liner is
> the taught path because the same `StartUp` boots your component tests.

## 5. Test locally

Before deploying, exercise the exported `handler` in-memory with the same builder you'll ship, using
`@benzenejs/aws-lambda-testing` to construct native events and `@benzenejs/testing`'s builders for payloads:

```bash
npm install --save-dev vitest @benzenejs/testing @benzenejs/aws-lambda-testing
```

```ts
// test/apiGateway.test.ts
import { describe, expect, it } from 'vitest';
import { Context } from 'aws-lambda';
import { httpBuilder } from '@benzenejs/testing';
import { asApiGatewayRequest } from '@benzenejs/aws-lambda-testing';
import { handler } from '../src/handler.js';

const context = {} as Context;
const noopCallback = () => undefined;

describe('orders-lambda', () => {
  it('POST /orders returns a 201 confirmation', async () => {
    const event = asApiGatewayRequest(httpBuilder('POST', '/orders', { customerId: 'acme' }));

    const response = (await handler(event, context, noopCallback)) as { statusCode: number; body: string };

    expect(response.statusCode).toBe(201); // BenzeneResult.created -> 201
    expect(JSON.parse(response.body)).toEqual({ orderId: 'order-acme' });
  });
});
```

`asApiGatewayRequest(...)` builds the exact API Gateway event shape AWS delivers, and invoking `handler`
runs your real pipeline end-to-end — the same code path a deployed function takes. The matching
`asSqs`/`asSns`/`asEventBridge`/`asAwsKafkaEvent` helpers cover the other transports. See
[Testing Benzene](testing-benzene.md) for the full pattern, and
[`examples/aws-lambda-functions`](../examples/aws-lambda-functions) for one domain tested across all
five transports.

## 6. Bundle and deploy

Lambda's `nodejs22.x` runtime runs a single JavaScript file, so bundle `src/handler.ts` and its
dependencies into one ESM file with [esbuild](https://esbuild.github.io/):

```bash
npx esbuild src/handler.ts --bundle --platform=node --format=esm --target=node22 \
  --outfile=dist/handler.mjs --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
```

That produces `dist/handler.mjs` exporting `handler`. Zip it (`cd dist && zip function.zip handler.mjs`)
and deploy with your tool of choice — the handler string is `handler.handler`.

A minimal AWS SAM `template.yaml`:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Globals:
  Function:
    Timeout: 30
    MemorySize: 512
    Runtime: nodejs22.x
    Architectures:
      - arm64

Resources:
  PlaceOrderFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: place-order
      Handler: handler.handler
      CodeUri: dist/
      Events:
        HttpApi:
          Type: HttpApi
```

```bash
sam deploy --guided
```

`sam deploy --guided` walks you through stack name and region on the first run, then remembers them in
`samconfig.toml`. Once deployed, SAM prints the API Gateway URL — `POST` to `/orders` with a JSON body
to confirm the handler responds. (If you prefer Serverless Framework or CDK, point the function's
handler at the same `handler.handler` and let it bundle with esbuild.)

## 7. Add a second transport

The whole point of Benzene is that a handler doesn't care which transport delivered its message. Add an
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
whichever async transport delivers it. Now you have a **deployment choice**.

### Model A — one Lambda function per transport (the default)

`useSqs` is already included in `@benzenejs/aws-lambda`. Give it its own `StartUp` and entry point:

```ts
// src/sqsStartUp.ts
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene, useAwsLambda, useSqs, useMessageHandlers } from '@benzenejs/aws-lambda';
import { NotifyWarehouseHandler } from './handlers.js';

export class SqsStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
  }
  configure(app: IBenzeneApplicationBuilder): void {
    useAwsLambda(app, (aws) => useSqs(aws, (sqs) => useMessageHandlers(sqs, NotifyWarehouseHandler)));
  }
}
```

```ts
// src/sqs.ts
import { AwsLambdaHost } from '@benzenejs/aws-lambda';
import { SqsStartUp } from './sqsStartUp.js';

export const handler = new AwsLambdaHost(SqsStartUp).lambdaHandler;
```

Bundle `src/sqs.ts` to its own file and deploy it as a second Lambda function, with an SQS event-source
mapping pointing at `sqs.handler`. This is the port's default — **one transport per entry point** —
because under type erasure two transports can't share a single DI container (their message getters
register under the same erased token and overwrite each other). It maps cleanly to the AWS deployment
where each trigger points at its own Lambda function. Splitting like this doesn't multiply cold starts:
those scale with concurrency, not function count.

### Model B — one Lambda function, several triggers (`compositeAwsLambda`)

When you'd rather have **one Lambda function fronting several triggers** — the AWS analog of .NET's
single stream-sniffing entry point — use `compositeAwsLambda`. It keeps each transport in its own
isolated container/pipeline (so no erasure collision) but exposes them behind one exported `handler`.
AWS delivers each trigger's event to that handler; the composite picks the first route whose
event-shape predicate matches and delegates:

```ts
// src/index.ts
import { useMessageHandlers, compositeAwsLambda, isApiGatewayEvent, isSqsEvent, toLambdaHandler, useApiGateway, useSqs } from '@benzenejs/aws-lambda';
import { PlaceOrderHandler, NotifyWarehouseHandler } from './handlers.js';

const entryPoint = compositeAwsLambda((c) => {
  c.route(isApiGatewayEvent, (app) => useApiGateway(app, (api) => useMessageHandlers(api, PlaceOrderHandler)));
  c.route(isSqsEvent,        (app) => useSqs(app, (sqs) => useMessageHandlers(sqs, NotifyWarehouseHandler)));
});

export const handler = toLambdaHandler(entryPoint);
```

`configureServices` registrations apply to every route, and a registered **instance**
(`addSingletonInstance`) is the *same object* across all routes — a genuinely shared singleton — whereas
a factory singleton is built once per route. The event-shape predicates (`isApiGatewayEvent`,
`isApiGatewayV2Event`, `isSqsEvent`, `isSnsEvent`, `isEventBridgeEvent`, `isKafkaEvent`,
`isKinesisEvent`, `isDynamoDbEvent`, `isS3Event`) are the single source of truth each transport's own
routing delegates to.

Splitting into per-function Lambdas or consolidating into one composite is a deployment decision, not a
rewrite — the transport wiring inside `configure`/`route` is identical either way.

## Supported event sources

Each transport is a `use…` free function you call inside `configure` (Model A) or a `route` (Model B).
A given function can wire up several sources; the incoming event's shape selects the right sub-pipeline.

| Event source | Function | Package |
|---|---|---|
| API Gateway (REST + HTTP API) | `useApiGateway` | `@benzenejs/aws-lambda-api-gateway` |
| SQS | `useSqs` | `@benzenejs/aws-lambda-sqs` |
| SNS | `useSns` | `@benzenejs/aws-lambda-sns` |
| EventBridge | `useEventBridge` | `@benzenejs/aws-lambda-eventbridge` |
| Kafka (MSK / self-managed) | `useKafka` | `@benzenejs/aws-lambda-kafka` |
| DynamoDB Streams | `useDynamoDb` | `@benzenejs/aws-lambda-dynamodb` |
| S3 | `useS3` | `@benzenejs/aws-lambda-s3` |
| Kinesis | `useKinesis` | `@benzenejs/aws-lambda-kinesis` |

The [`examples/aws-lambda-functions`](../examples/aws-lambda-functions) project hosts one order domain on
API Gateway, SQS, SNS, EventBridge, and Kafka — one function module per transport, each its own unified
`BenzeneStartUp` booted by the `new AwsLambdaHost(StartUp).lambdaHandler` one-liner.

### SQS

```ts
useSqs(app, (sqs) => useMessageHandlers(sqs, NotifyWarehouseHandler));
```

SQS messages are processed in batches; each record's body is deserialized to your request type and
message attributes are mapped to headers. The topic is normally read from a `topic` message attribute
set by a Benzene client. If a queue's producer isn't a Benzene client and never sets one (a raw SQS
send, or a queue fed by another system), call `usePresetTopic` before `useMessageHandlers` to route
every message on that queue to a fixed topic instead:

```ts
import { usePresetTopic, useMessageHandlers } from '@benzenejs/aws-lambda';

useSqs(app, (sqs) => {
  usePresetTopic(sqs, 'order:placed');
  useMessageHandlers(sqs, NotifyWarehouseHandler);
});
```

See [Common Middleware](common-middleware.md) for `usePresetTopic` in full.

### SNS

```ts
useSns(app, (sns) => useMessageHandlers(sns, NotifyWarehouseHandler));
```

The topic is resolved from a `topic` message attribute and routed to the matching handler, same as
every other transport. There is no response to write back — SNS delivery is fire-and-forget.

### EventBridge

```ts
useEventBridge(app, (eb) => useMessageHandlers(eb, NotifyWarehouseHandler));
```

The event's `detail-type` is the message topic — EventBridge's native routing key, so
`@message('order:placed', …)` handles events published with that detail-type — and `detail` is the
message body. Like SNS, delivery is fire-and-forget.

### Kafka

```ts
useKafka(app, (kafka) => useMessageHandlers(kafka, NotifyWarehouseHandler));
```

Works for both Amazon MSK and self-managed Kafka. The record's Kafka topic routes it and the base64
record value is the payload; record headers are mapped to Benzene message headers.

### Adding validation

Reject bad payloads before they reach a handler by configuring a router around the handlers with
`useMessageHandlersWithRouter` and a validation adapter such as `useZodValidation`:

```ts
import { useMessageHandlersWithRouter } from '@benzenejs/aws-lambda';
import { useZodValidation } from '@benzenejs/zod';

useSqs(app, (sqs) =>
  useMessageHandlersWithRouter(sqs, (router) => useZodValidation(router), NotifyWarehouseHandler),
);
```

See [Validation](validation.md) for the Zod, Joi, and Yup adapters.

## Configuration

`AwsLambdaHost` builds the pipeline once, on cold start. Register configuration inside your `StartUp`'s
`configureServices` — in Lambda the natural source is the function's environment variables via
`process.env`, which you set in the SAM template, console, or CDK/Terraform:

```ts
export class StartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    addBenzene(services);
    services.addSingletonInstance(OrdersConfig, { tableName: process.env.ORDERS_TABLE ?? 'orders' });
  }
  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useAwsLambda(app, (aws) => useApiGateway(aws, (api) => useMessageHandlers(api, PlaceOrderHandler)));
  }
}
```

> Prefer the small `BenzeneConfiguration` key/value lookup (the second parameter) over reading
> `process.env` inline when a component test needs to layer overrides — implement `getConfiguration(): {
> get: (key) => process.env[key] }` on the `StartUp` and the test can override any key with
> `benzeneTestHost(StartUp).withConfiguration({ ... })`. The port's `BenzeneConfiguration` stands in for
> .NET's richer `IConfiguration`; see the [Porting conventions](../README.md#porting-conventions).

## Troubleshooting

**Function crashes immediately / "cannot read properties of undefined".** You almost certainly wrote
`export const handler = host.functionHandlerAsync`, which detaches `this`. Use
`export const handler = new AwsLambdaHost(StartUp).lambdaHandler` — see
[step 4](#4-write-the-composition-root-and-the-entry-point).

**Handler never called / 404 from API Gateway.** Check that `@httpEndpoint('METHOD', '/path')` matches
the request exactly (method and path), and that the handler class was passed to `useMessageHandlers(...)`.

**SQS/SNS/Kafka message never routes to a handler.** These transports resolve the topic from a message
attribute (or the record's topic), not the body. Confirm the producer sets a `topic` attribute, or call
`usePresetTopic(...)` to pin a fixed topic — and confirm a handler exists with a matching
`@message('...')` topic.

**Two transports in one non-composite entry point clash.** Under type erasure two transports can't share
one container. Give each transport its own `StartUp` + `AwsLambdaHost` (Model A) or use
`compositeAwsLambda` (Model B) — don't call two `use…` transports inside a single `configure`.

**Bundle fails to load on Lambda (ESM / `require` errors).** Ensure you bundle with
`--format=esm --platform=node --target=node22` and name the output `.mjs` (or set `"type":"module"` in a
`package.json` shipped alongside it), so the `nodejs22.x` runtime loads it as an ES module.

**Cold starts feel slow.** `new AwsLambdaHost(StartUp)` runs `configureServices`/`configure` once per
execution environment, so cold-start cost is dominated by whatever `configureServices` does. Prefer lazy
initialization inside your services over eager work (e.g. opening a DB connection) at construction time.

## See Also

- [Getting Started](getting-started.md) — build the same handler locally on Express first
- [Azure Functions Setup](azure-functions.md) — the same handlers, hosted on Azure
- [Message Handlers](message-handlers.md) — the handler contract, topics, and `@message`/`@httpEndpoint`
- [Message Result](message-result.md) — `BenzeneResult.ok`/`.created` and the result envelope
- [Middleware](middleware.md) and [Common Middleware](common-middleware.md) — what else composes into the pipeline
- [Validation](validation.md) — reject bad requests with the Zod, Joi, or Yup adapters
- [Correlation IDs](correlation-ids.md) — trace requests across services
- [Testing Benzene](testing-benzene.md) — testing handlers and pipelines end-to-end
- [Cookbooks](cookbooks/README.md) — recipes for real-world scenarios
- [`examples/aws-lambda-functions`](../examples/aws-lambda-functions) — one domain on five AWS transports

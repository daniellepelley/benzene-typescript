# Payload Testing

Construct a demo payload for a *topic* and send it into a running service through the same pipeline every
transport uses — routing, validation, middleware, handler — no matter which transport normally feeds that
topic.

## Overview

AWS ships a Lambda Test Tool for firing test payloads at a locally running Lambda; Swagger UI lets you
build and send test requests against an HTTP API. Benzene's equivalent is **topic-centric**: because every
transport converts its native message into the *same* message pipeline, you can exercise a topic through
that pipeline directly — build the payload, address it to a topic, and dispatch it — regardless of whether
that topic also has an HTTP mapping or is normally fed by SQS, SNS, EventBridge, Kafka, or Event Hubs.

This is deliberately narrower than the full [Testing Benzene](testing-benzene.md) surface. That guide
covers two levels — a handler in isolation (call `handleAsync`, assert the result) and a whole transport
pipeline driven end to end from your production wiring. **This** page is the *"I have a payload and a
topic, send it"* story: the analog of the Lambda Test Tool / Swagger *Try it* workflow. The two share the
same builders, so anything you learn here transfers straight over.

Three steps do the work:

1. **Build the payload** with `messageBuilder(topic, body)` or `httpBuilder(method, path, body)`.
2. **Render it** into a transport-native event with an `as*` builder (`asBenzeneMessage`,
   `asApiGatewayRequest`, `asSqs`, …).
3. **Send it** into an in-memory service — either the transport-neutral message pipeline (dispatches by
   topic) or a real entry point built from your production wiring.

## Prerequisites / Installation

Node 22+ is required. The builders are dev-only:

```bash
npm install --save-dev @benzene/testing
```

`@benzene/testing` carries the platform-neutral builders (`messageBuilder`, `httpBuilder`,
`asBenzeneMessage`, `asRawHttpRequest`). For a *transport-shaped* payload — an SQS event, an API Gateway
request — add the matching per-transport helper, which builds the native event for you:

```bash
npm install --save-dev @benzene/aws-lambda-testing
# or
npm install --save-dev @benzene/azure-function-testing
```

## The `BenzeneMessage` envelope

A `BenzeneMessage` is the transport-neutral carrier: `{ topic, headers, body }`, where `body` is the
payload serialized the way the real transport would send it (JSON by default). The envelope itself is
always plain JSON regardless of what payload format the app negotiates. A malformed or topic-less envelope
routes to a `bad-request` / `not-found` result rather than throwing.

## Step 1 — build the payload

`messageBuilder(topic, body)` describes a topic-addressed message; `httpBuilder(method, path, body)`
describes an HTTP-shaped one. Both take a typed body and carry fluent headers via `withHeader` /
`withHeaders`:

```ts
import { messageBuilder, httpBuilder } from '@benzene/testing';

// A topic payload — the way a queue or event source addresses it.
const payload = messageBuilder('order:create', { customerId: '11111111-1111-1111-1111-111111111111' })
  .withHeader('x-correlation-id', 'demo-1');

// The same logical request expressed as an HTTP call.
const httpPayload = httpBuilder('POST', '/orders', { customerId: '11111111-1111-1111-1111-111111111111' });
```

A builder is just a *description*. The body is not serialized until you render it in Step 2, so a single
builder can be turned into many different transport events.

## Step 2 — render it into a transport event

Each `as*` builder turns a builder into the exact shape one transport routes on. The transport-neutral
ones live in `@benzene/testing`:

```ts
import { asBenzeneMessage, asRawHttpRequest } from '@benzene/testing';

// A BenzeneMessageRequest: { topic, headers, body }, with body serialized to a JSON string.
const envelope = asBenzeneMessage(payload);

// Or a raw HTTP/1.1 request string (CRLF line endings), e.g. to pipe at a socket.
const raw = asRawHttpRequest(httpPayload);
```

The native-event builders live in the per-platform packages — the topic rides whatever field the adapter
reads (a `topic` message attribute for SQS/SNS, method + path for API Gateway, and so on):

```ts
import { asSqs, asSns, asApiGatewayRequest } from '@benzene/aws-lambda-testing';
import { asAzureServiceBusMessage } from '@benzene/azure-function-testing';

const sqsEvent = asSqs(payload);                     // SQSEvent
const snsEvent = asSns(payload);                     // SNSEvent
const apiEvent = asApiGatewayRequest(httpPayload);   // APIGatewayProxyEvent
const busEvent = asAzureServiceBusMessage(payload);  // Service Bus message
```

Two different option shapes apply, so know which you are calling:

- **Transport builders** (`asSqs`, `asSns`, `asApiGatewayRequest`, `asEventBridge`, …) take a trailing
  **options object**. Pass `serializer` to render the body in a format other than JSON, or
  `numberOfMessages` on `asSqs` / `asSns` to emit a batch: `asSqs(payload, { numberOfMessages: 2 })`.
- **The neutral builders** `asBenzeneMessage` and `asRawHttpRequest` take the **serializer directly** as an
  optional second argument (defaulting to JSON): `asBenzeneMessage(payload, myXmlSerializer)`.

The full table — `asApiGatewayV2Request`, `asEventBridge`, `asAwsKafkaEvent`, `asDynamoDb`, `asKinesis`,
`asS3`, `asAzureHttpRequest`, `asEventHubBenzeneMessage`, `asAzureKafkaEvent`, and what each routes on —
lives in [Testing Benzene](testing-benzene.md).

## Step 3 — send it into a service in-memory

The most direct way to fire a demo payload is through the **topic-neutral message pipeline**, which
dispatches by topic regardless of any HTTP route or queue binding. Build a `BenzeneMessageApplication`,
hand it the `asBenzeneMessage` envelope, and read the response envelope back:

```ts
import { BenzeneMessageContext, BenzeneMessageRequest } from '@benzene/core-messages';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { BenzeneResultStatus } from '@benzene/results';
import {
  addBenzeneMessage,
  BenzeneMessageApplication,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { messageBuilder, asBenzeneMessage } from '@benzene/testing';
import { CreateOrderHandler } from './src/CreateOrderHandler.js';

const container = new DefaultBenzeneServiceContainer();
addBenzeneMessage(container);

const builder = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
useMessageHandlers(builder, CreateOrderHandler);
const app = new BenzeneMessageApplication(builder.build());

// Build -> render -> send.
const request: BenzeneMessageRequest = asBenzeneMessage(
  messageBuilder('order:create', { customerId: '11111111-1111-1111-1111-111111111111' }),
);
const response = await app.handleAsync(request, container.createServiceResolverFactory());

console.log(response.statusCode); // 'ok' — a BenzeneResultStatus
console.log(response.body);       // '{"orderId":"..."}'
if (response.statusCode !== BenzeneResultStatus.ok) process.exitCode = 1;
```

The response is the wire envelope `{ statusCode, headers, body }`, with `body` the serialized payload as a
JSON string. The `statusCode` is a `BenzeneResultStatus` (`ok`, `notFound`, `validationError`, …) — assert
against the constant rather than a raw string. Because the envelope is byte-for-byte identical across
languages, a payload a TypeScript service answers classifies the same in a .NET peer.

### Exercising one transport's routing exactly

To reproduce not just the handler but the *routing and request-mapping* a specific transport performs,
render the payload into that transport's native event and drive a real entry point built from your
production wiring. For AWS that means booting a `StartUp` with `new AwsLambdaHost(StartUp).lambdaHandler`,
the same entry point AWS invokes:

```ts
import { Context } from 'aws-lambda';
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzene/core-message-handlers';
import { AwsLambdaHost, useAwsLambda } from '@benzene/aws-lambda-core';
import { useApiGateway } from '@benzene/aws-lambda-api-gateway';
import { httpBuilder } from '@benzene/testing';
import { asApiGatewayRequest } from '@benzene/aws-lambda-testing';
import { CreateOrderHandler } from './src/CreateOrderHandler.js';

class OrderStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
  }
  configure(app: IBenzeneApplicationBuilder): void {
    useAwsLambda(app, (aws) => useApiGateway(aws, (api) => useMessageHandlers(api, CreateOrderHandler)));
  }
}

const handler = new AwsLambdaHost(OrderStartUp).lambdaHandler;

const event = asApiGatewayRequest(httpBuilder('POST', '/orders', { customerId: '1111' }));
const response = (await handler(event, {} as Context, () => undefined)) as { statusCode: number };
console.log(response.statusCode); // 200
```

Queue and event transports drive the same way — swap `asApiGatewayRequest` for `asSqs` / `asSns` /
`asEventBridge` and wire the matching `useSqs` / `useSns` / … helper inside `useAwsLambda(app, (aws) => …)`.
The Azure counterpart is a `StartUp` booted by `new AzureFunctionHost(StartUp)` with the `asAzure*`
builders. Both full end-to-end paths, for every AWS and Azure transport, are documented with runnable
examples in [Testing Benzene](testing-benzene.md), and the production wiring these build from is covered in
[Getting Started (AWS)](getting-started-aws.md) and [Azure Functions](azure-functions.md).

## Distinguishing payload testing from unit testing

These two answer different questions, and it is worth being deliberate about which you reach for:

- **Unit testing a handler** constructs the handler with fake dependencies and calls `handleAsync`
  directly, asserting the returned result. It is the fastest way to cover business branches — validation
  short-circuits, error statuses, edge cases — but it exercises *no* routing, body deserialization, or
  middleware. See [Testing Benzene](testing-benzene.md) for that level.
- **Payload testing** (this page) starts from a *wire payload* and a *topic* and sends it through a real
  pipeline, so routing, request-mapping, and middleware all run. It is the fastest way to reproduce a
  production failure locally: build the failing topic's payload, run it through the pipeline, and read the
  result back.

## Probing a running service

`@benzene/testing` sends payloads *in-process*. The one ported tool that fires an envelope at a *live*
service over HTTP is the Cloud Service conformance probe (`@benzene/cloud-service-probe`) — but note that
it is **not** a general topic-dispatch tool. It POSTs a small set of fixed synthetic envelopes (its own
`healthcheck` and `mesh` envelopes) at a service's `/benzene/*` surfaces to assess black-box conformance to
the Cloud Service Profile (R1–R8), and reports a tri-state verdict built only from what it observed:

```ts
import { CloudServiceProbe } from '@benzene/cloud-service-probe';

const report = await CloudServiceProbe.runAsync('https://my-service.example.com');
console.log(report.notSatisfied);      // ids observed as unmet, e.g. []
console.log(report.inconclusive);      // ids unobservable from outside, e.g. ['R8']
console.log(report.isFullyConformant); // boolean
```

Use it to answer *"is this deployed service reachable and wire-conformant?"* — not to fire an arbitrary
topic, since it only ever sends its own envelopes. `CloudServiceProbeOptions` (`invokePath`, `specPath`,
`healthPath`, `sendTraceParentProbe`) points it at non-default paths.

## Not yet ported

The .NET library also ships an HTTP `UseBenzeneMessage` endpoint (which dispatches a POSTed
`BenzeneMessage` envelope at a running service) and a `benzene` CLI that generates per-topic /
per-transport test-payload files for the Lambda Test Tool. Those are **.NET-only for now** — the
TypeScript port covers payload testing through the in-process `@benzene/testing` helpers above rather
than a hosted endpoint or CLI. To send a topic-addressed payload at a running instance today, drive the
in-process message pipeline from a small script, or drop the `asSqs(...)` event on the real queue the
topic is bound to. (The browser *Try it* Spec UI **is** ported — `@benzene/spec-ui`'s `useSpecUi` renders
the `useSpec` document in-browser; see [Common Middleware](common-middleware.md#not-yet-ported).)

## Troubleshooting

- **`not-found` status back.** The topic on your `messageBuilder` does not match any handler's `@message`
  topic, or the handler was never passed to `useMessageHandlers`. Check the exact topic string.
- **Payload comes through empty / `undefined`.** The handler's request type did not deserialize the body.
  Confirm the body you built in Step 1 matches the handler's request shape, and that you rendered with a
  serializer the pipeline can read (JSON by default).
- **Wrong option shape.** `numberOfMessages` and `serializer` go in the *options object* of a transport
  builder (`asSqs(payload, { serializer })`); `asBenzeneMessage` takes the serializer as a bare second
  argument (`asBenzeneMessage(payload, serializer)`).
- **A dependency needs replacing.** Register a fake against its token inside the `StartUp`'s
  `configureServices(...)` after Benzene's baseline registrations, or layer it on with
  `benzeneTestHost(StartUp).withServices(...)` when driving the entry point from a test — see
  [Testing Benzene](testing-benzene.md).

## See Also

- [Testing Benzene](testing-benzene.md) — the full in-process testing surface and the complete `as*`
  builder reference table.
- [Message Handlers](message-handlers.md) — topics, the handler contract, and `handleAsync`.
- [Getting Started (AWS)](getting-started-aws.md) — the AWS Lambda production wiring these payloads drive.
- [Azure Functions](azure-functions.md) — the Azure Functions production wiring and its `asAzure*` builders.
- [README](../README.md) — porting conventions and the package table.

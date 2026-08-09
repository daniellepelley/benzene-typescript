# Testing Benzene

Benzene services are built to be tested at two levels: a **handler in isolation** — the fast unit
test, calling `handleAsync` directly and asserting the [result](message-result.md) — and a **whole
transport pipeline end to end** — building an in-memory host from the same wiring you deploy, feeding
it a native cloud event, and asserting the transport-native response. The end-to-end approach is the
recommended one, since it exercises routing, request mapping, middleware, and your handler exactly as
production does rather than any one piece in isolation.

## Overview

The test helpers live in three packages, all dev-only:

- **`@benzene/testing`** — the platform-neutral request builders `messageBuilder(topic, body)` and
  `httpBuilder(method, path, body)`, plus `asBenzeneMessage` / `asRawHttpRequest`. These describe a
  request once, independent of transport.
- **`@benzene/aws-lambda-testing`** — turns a builder into a native AWS event (`asApiGatewayRequest`,
  `asSqs`, `asSns`, `asEventBridge`, `asAwsKafkaEvent`, `asDynamoDb`, `asKinesis`, `asS3`, …).
- **`@benzene/azure-function-testing`** — the Azure counterpart (`asAzureHttpRequest`,
  `asAzureServiceBusMessage`, `asEventHubBenzeneMessage`, `asAzureKafkaEvent`).

You then drive the generated event through a real app booted from its own `BenzeneStartUp` with the
`benzeneTestHost` startup-host harness. A `BenzeneStartUp` is a small class with two methods — the same
`configureServices` / `configure` split every host uses — that a test boots as-is:

```ts
// src/OrdersStartUp.ts
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { BenzeneStartUp } from '@benzene/testing';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { useAwsLambda } from '@benzene/aws-lambda-core';
import { useApiGateway } from '@benzene/aws-lambda-api-gateway';
import { CreateOrderHandler } from './handlers.js';

export class OrdersStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    // register your real services here — a test overrides any of them via `.withServices(...)`
  }

  configure(app: IBenzeneApplicationBuilder): void {
    useAwsLambda(app, (aws) => useApiGateway(aws, (api) => useMessageHandlers(api, CreateOrderHandler)));
  }
}
```

Booting it is then the same construction a deployed [AWS Lambda](getting-started-aws.md) or
[Azure Functions](azure-functions.md) host performs:

```ts
const fake = new FakeBenzeneMessageSender();

const host = benzeneTestHost(OrdersStartUp)              // boot the REAL app from its startup
  .withServices((s) => s.addSingletonInstance(IBenzeneMessageSender, fake))  // override ANY registration
  .buildAwsLambdaHost();                                 // the ONE transport/cloud-specific line

const response = await host.sendEventAsync<APIGatewayProxyResult>(
  asApiGatewayRequest(httpBuilder('POST', '/orders', order)),
);

expect(response.statusCode).toBe(201);                   // assert the native response…
expect(fake.lastTopic).toBe('order:created');            // …and the egress
```

To test the same handlers on Azure, only the `.buildAwsLambdaHost()` line (→ `.buildAzureFunctionApp()`)
and the `as*` builder change; everything else is identical. The worked exemplars live in
`test/Benzene.Core.Test/Testing/BenzeneTestHostTest.test.ts`.

> **Fidelity to .NET.** `benzeneTestHost(StartUp)` ports the .NET `BenzeneTestHost` / `BenzeneTestHostBuilder`
> (`benzeneTestHost` → `Create`, `.withServices` → `WithServices`, `.withConfiguration` → `WithConfiguration`,
> `.buildAwsLambdaHost()`/`.buildAzureFunctionApp()` → the `Build*Host` extensions). Two idiom bends are
> recorded in the [README](../README.md#porting-conventions): the neutral `BenzeneStartUp` is generic over
> its app-builder type (the per-transport app-builder unification is still deferred), and the `Build*`
> extension is a fluent method added by module augmentation. You can still drive a transport directly via
> its `Inline*StartUp` entry point (as some low-level unit tests below do) when you want to bypass a startup
> class entirely.

## Installation

```bash
npm install --save-dev vitest @benzene/testing @benzene/aws-lambda-testing @benzene/azure-function-testing
```

Add only the transport testing package you actually use. Tests run under [vitest](https://vitest.dev/)
(`npm test`), the port's counterpart to the .NET suite's xUnit.

The examples below assume this handler, which pushes its logic into an injected service so the handler
itself stays thin (see [Message Handlers](message-handlers.md)):

```ts
// src/GreetingService.ts
import { ServiceToken, serviceToken } from '@benzene/abstractions';

export interface IGreetingService {
  greetAsync(name: string): Promise<string>;
}

// A resolved interface declares a merged ServiceToken constant of the same name (README convention).
export const IGreetingService: ServiceToken<IGreetingService> =
  serviceToken<IGreetingService>('IGreetingService');
```

```ts
// src/HelloWorldHandler.ts
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { BenzeneResult } from '@benzene/results';
import { IGreetingService } from './GreetingService.js';

export class HelloWorldRequest {
  name?: string;
}
export class HelloWorldResponse {
  message?: string;
}

@httpEndpoint('POST', '/hello')
@message('hello:world', { requestType: HelloWorldRequest, responseType: HelloWorldResponse })
export class HelloWorldHandler implements IMessageHandler<HelloWorldRequest, HelloWorldResponse> {
  static readonly inject = [IGreetingService] as const;
  constructor(private readonly greetings: IGreetingService) {}

  async handleAsync(request: HelloWorldRequest): Promise<IBenzeneResultOf<HelloWorldResponse>> {
    const response = new HelloWorldResponse();
    response.message = await this.greetings.greetAsync(request.name ?? 'world');
    return BenzeneResult.ok(response);
  }
}
```

## Testing a handler in isolation

The fastest test needs no pipeline and no container: construct the handler with a fake dependency,
call `handleAsync`, and assert on the returned `IBenzeneResultOf<T>`. A result carries `status`,
`isSuccessful`, `payload`, and `errors`, so you assert both the status and the payload:

```ts
// test/HelloWorldHandler.test.ts
import { describe, expect, it } from 'vitest';
import { BenzeneResultStatus } from '@benzene/results';
import { HelloWorldHandler, HelloWorldRequest } from '../src/HelloWorldHandler.js';
import { IGreetingService } from '../src/GreetingService.js';

// A hand-rolled fake — no mocking library required. Use vitest's `vi.fn()` if you prefer.
const fakeGreetings: IGreetingService = {
  greetAsync: (name) => Promise.resolve(`Hello ${name}!`),
};

describe('HelloWorldHandler', () => {
  it('returns an ok result with the greeting payload', async () => {
    const handler = new HelloWorldHandler(fakeGreetings);

    const request = new HelloWorldRequest();
    request.name = 'Ada';

    const result = await handler.handleAsync(request);

    expect(result.isSuccessful).toBe(true);
    expect(result.status).toBe(BenzeneResultStatus.ok);
    expect(result.payload.message).toBe('Hello Ada!');
  });
});
```

This is the level to unit-test business branches (validation short-circuits, error statuses, edge
cases) cheaply. It does **not** exercise routing, request-body deserialization, or middleware — for
that, drive the pipeline.

> Assert against the `BenzeneResultStatus` constants (`ok`, `notFound`, `validationError`, …) rather
> than raw strings — they are the normative wire-status vocabulary, shared byte-for-byte with .NET.
> See [Message Results](message-result.md).

## Driving a transport pipeline end to end (recommended)

Build a real entry point from your production wiring, turn a builder into a native event, and call the
entry point's handler. This is the closest a test gets to a live invocation.

### AWS Lambda

`InlineAwsLambdaStartUp` builds an entry point whose `functionHandlerAsync(event, context)` is exactly
what AWS invokes. Feed it an `asApiGatewayRequest(...)` (or `asSqs`, `asSns`, …) event and assert the
transport-native response:

```ts
// test/HelloPipeline.test.ts
import { describe, expect, it } from 'vitest';
import { Context, APIGatewayProxyResult } from 'aws-lambda';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { InlineAwsLambdaStartUp } from '@benzene/aws-lambda-core';
import { useApiGateway } from '@benzene/aws-lambda-api-gateway';
import { httpBuilder } from '@benzene/testing';
import { asApiGatewayRequest } from '@benzene/aws-lambda-testing';
import { HelloWorldHandler } from '../src/HelloWorldHandler.js';
import { IGreetingService } from '../src/GreetingService.js';

const fakeGreetings: IGreetingService = {
  greetAsync: (name) => Promise.resolve(`Hello ${name}!`),
};

const fakeLambdaContext = {} as Context;

describe('hello pipeline (API Gateway)', () => {
  it('routes POST /hello to the handler and returns 200', async () => {
    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((services) => {
        // Register the fake against its token so the handler's `inject` resolves it.
        services.addScopedInstance(IGreetingService, fakeGreetings);
      })
      .configure((app) => useApiGateway(app, (api) => useMessageHandlers(api, HelloWorldHandler)))
      .build();

    const event = asApiGatewayRequest(httpBuilder('POST', '/hello', { name: 'Ada' }));
    const response = (await entryPoint.functionHandlerAsync(
      event,
      fakeLambdaContext,
    )) as APIGatewayProxyResult;

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ message: 'Hello Ada!' });
  });
});
```

The `.configureServices(...)` block is where you **override services**: register a fake instance
against a token with `addScopedInstance` / `addSingletonInstance` (or a factory with
`addScopedFactory`); registered after Benzene's baseline services, it replaces whatever the real wiring registered — the
standard way to swap in mocks or point a dependency at a locally running component (a Docker database,
say) without touching real configuration. This is the port's equivalent of the .NET
`WithServices(...)` override.

### Queue and event transports

Every AWS transport is driven the same way — only the builder and the response shape change. An SQS
handler with no `@httpEndpoint`, fed by `asSqs`, reports partial-batch failures:

```ts
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { InlineAwsLambdaStartUp } from '@benzene/aws-lambda-core';
import { useSqs } from '@benzene/aws-lambda-sqs';
import { messageBuilder } from '@benzene/testing';
import { asSqs } from '@benzene/aws-lambda-testing';

const entryPoint = new InlineAwsLambdaStartUp()
  .configure((app) => useSqs(app, (sqs) => useMessageHandlers(sqs, ProcessOrderHandler)))
  .build();

// `numberOfMessages` emits N identical records; the topic rides the `topic` message attribute.
const event = asSqs(messageBuilder('order:process', { orderId: '42' }), { numberOfMessages: 2 });
const response = (await entryPoint.functionHandlerAsync(event, fakeLambdaContext)) as {
  batchItemFailures: { itemIdentifier: string }[];
};

expect(response.batchItemFailures).toEqual([]); // both records succeeded
```

The `as*` builders each take a trailing options object (`{ serializer?, numberOfMessages? }`) and set
whatever the adapter routes on — the `topic` attribute for SQS/SNS, `detail-type` for EventBridge, the
record topic for Kafka, `{table}:{eventName}` for DynamoDB. `asS3` is the exception: an S3 notification
has no JSON body, so it takes a bucket and key directly (`asS3('my-bucket', 'photos/cat.png',
{ eventName: 'ObjectCreated:Put' })`). Kinesis carries no topic, so pair `asKinesis(...)` with a
`usePresetTopic(kinesis, 'order:process')` in the pipeline. See
[`test/Benzene.Core.Test/Testing/AwsLambdaTestingTest.test.ts`](../test/Benzene.Core.Test/Testing/AwsLambdaTestingTest.test.ts)
for every AWS builder driven end to end.

### Azure Functions

`InlineAzureFunctionStartUp` builds an `IAzureFunctionApp` that already exposes typed dispatch helpers
per trigger — `handleHttpRequest`, `handleServiceBusMessages`, `handleEventHub`, `handleKafkaEvents`.
Pair each with the matching `asAzure*` builder:

```ts
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { InlineAzureFunctionStartUp } from '@benzene/azure-function-core';
import { handleHttpRequest, useAzureHttp } from '@benzene/azure-function-http';
import { httpBuilder } from '@benzene/testing';
import { asAzureHttpRequest } from '@benzene/azure-function-testing';

const app = new InlineAzureFunctionStartUp()
  .configureServices((services) => {
    services.addScopedInstance(IGreetingService, fakeGreetings);
  })
  .configure((builder) => useAzureHttp(builder, (http) => useMessageHandlers(http, HelloWorldHandler)))
  .build();

const response = await handleHttpRequest(app, asAzureHttpRequest(httpBuilder('POST', '/hello', { name: 'Ada' })));

expect(response.status).toBe(200);
expect(JSON.parse(response.body as string)).toEqual({ message: 'Hello Ada!' });
```

Service Bus, Event Hub, and Kafka work identically — send an `asAzureServiceBusMessage(...)`,
`asEventHubBenzeneMessage(...)`, or `asAzureKafkaEvent(...)` through the corresponding `handle*` helper.
Event Hub carries a Benzene message envelope, so its handler is wired under `useBenzeneMessage` inside
`useEventHub`. See
[`test/Benzene.Core.Test/Testing/AzureFunctionTestingTest.test.ts`](../test/Benzene.Core.Test/Testing/AzureFunctionTestingTest.test.ts)
for all four triggers.

## Topic-centric testing: the BenzeneMessage envelope

Sometimes you want to exercise a topic through the **transport-neutral** message pipeline —
regardless of whether it also has an HTTP route or is normally fed from a queue. `asBenzeneMessage`
turns a `messageBuilder` into a `BenzeneMessageRequest` (topic + serialized body + headers), which you
drive through a `BenzeneMessageApplication`. This is the port's analog of the .NET direct-invoke
`SendBenzeneMessageAsync`:

```ts
import { describe, expect, it } from 'vitest';
import { BenzeneMessageContext } from '@benzene/core-messages';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { BenzeneResultStatus } from '@benzene/results';
import {
  addBenzeneMessage,
  BenzeneMessageApplication,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { messageBuilder, asBenzeneMessage } from '@benzene/testing';

describe('hello via the message pipeline', () => {
  it('routes the topic and round-trips the payload', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzeneMessage(container);
    container.addScopedInstance(IGreetingService, fakeGreetings);

    const builder = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
    useMessageHandlers(builder, HelloWorldHandler);
    const app = new BenzeneMessageApplication(builder.build());

    const request = asBenzeneMessage(messageBuilder('hello:world', { name: 'Ada' }));
    const response = await app.handleAsync(request, container.createServiceResolverFactory());

    expect(response.statusCode).toBe(BenzeneResultStatus.ok);
    expect(JSON.parse(response.body)).toEqual({ message: 'Hello Ada!' });
  });
});
```

The response is the wire envelope `{ statusCode, headers, body }` with `body` the serialized payload
as a JSON string — identical across languages, so a topic a TypeScript service answers classifies the
same in a .NET peer.

## Test-event builder reference

Every builder takes a `messageBuilder`/`httpBuilder` (or, for `asS3`, a bucket/key) plus an optional
trailing options object.

| Builder | Package | Produces | Routes on |
| --- | --- | --- | --- |
| `asBenzeneMessage` / `asRawHttpRequest` | `@benzene/testing` | `BenzeneMessageRequest` / raw HTTP string | topic / route |
| `asApiGatewayRequest` / `asApiGatewayV2Request` | `@benzene/aws-lambda-testing` | `APIGatewayProxyEvent` (v1/v2) | HTTP method + path |
| `asApiGatewayCustomAuthorizerEvent` | `@benzene/aws-lambda-testing` | `APIGatewayRequestAuthorizerEvent` | method + path (no body) |
| `asSqs` / `asSns` | `@benzene/aws-lambda-testing` | `SQSEvent` / `SNSEvent` | `topic` message attribute |
| `asEventBridge` | `@benzene/aws-lambda-testing` | `EventBridgeEvent` | `detail-type` |
| `asAwsKafkaEvent` | `@benzene/aws-lambda-testing` | `MSKEvent` | record topic |
| `asDynamoDb` | `@benzene/aws-lambda-testing` | `DynamoDBStreamEvent` | `{table}:{eventName}` |
| `asKinesis` | `@benzene/aws-lambda-testing` | `KinesisStreamEvent` | preset topic (`usePresetTopic`) |
| `asS3` | `@benzene/aws-lambda-testing` | `S3Event` | S3 event name (bucket/key body) |
| `asAzureHttpRequest` | `@benzene/azure-function-testing` | `@azure/functions` `HttpRequest` | HTTP method + path |
| `asAzureServiceBusMessage` | `@benzene/azure-function-testing` | Service Bus message | `topic` application property |
| `asEventHubBenzeneMessage` | `@benzene/azure-function-testing` | Event Hub envelope | envelope topic |
| `asAzureKafkaEvent` | `@benzene/azure-function-testing` | Kafka event | record topic |

## Notes and limitations

- **`benzeneTestHost` boots from your `BenzeneStartUp`.** Prefer it (top of this guide) to test the real
  app end to end; drop to `Inline*StartUp` only for low-level unit tests that deliberately bypass a startup
  class. The specialization method (`buildAwsLambdaHost` / `buildAzureFunctionApp`) lights up when you
  import its transport `*-testing` package, which you already do for the `as*` builder.
- **Configuration overrides.** `benzeneTestHost(...).withConfiguration(key, value)` (or an object) layers
  in-memory config over your startup's own `getConfiguration()` (last-wins), handed to `configureServices`/
  `configure` as a `BenzeneConfiguration`.
- **Express host.** For an [Express](getting-started.md)-hosted service you can test over real HTTP
  with [`supertest`](https://github.com/ladjs/supertest) against the `express()` app — the analog of
  .NET's `WebApplicationFactory` — since the app is a standard Express app; or use the API Gateway
  pipeline test above, which shares the same handler.
- **Workers.** A worker-only host isn't request/response-shaped, so there is no `as*`/`handle*` to
  call — drive the worker's lifecycle directly.

## See also

- [Message Handlers](message-handlers.md) — the handler contract and `handleAsync`.
- [Message Results](message-result.md) — `IBenzeneResultOf<T>`, `BenzeneResult`, and status mapping.
- [Middleware](middleware.md) — the pipeline the entry points build on.
- [Validation](validation.md) — asserting validation short-circuits before a handler runs.
- [Getting Started (AWS)](getting-started-aws.md) / [Azure Functions](azure-functions.md) — the
  production wiring these tests build from.
- [Cookbooks](cookbooks/README.md) — end-to-end recipes.
- Runnable projects: [`examples/`](../examples).

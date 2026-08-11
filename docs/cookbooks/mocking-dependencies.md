# Mocking External Dependencies

Test a message handler in isolation by swapping its real dependencies — databases, HTTP clients, cloud
SDKs — for fakes, while still exercising the full Benzene pipeline.

## Problem Statement

You want to test a handler's behavior without touching real infrastructure:

- Replace a repository, gateway, or SDK client with a fake.
- Still run the message through the real pipeline (routing, deserialization, validation) so the test
  reflects production.
- Assert both on the response and on how the dependency was called.

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and a Benzene service — see [Getting Started](../getting-started.md).
- A handler that takes its dependency via `static inject` (see [Message Handlers](../message-handlers.md)).
- The transport testing package for however you drive the pipeline (`@benzene/aws-lambda-testing` here).

## Installation

```bash
npm install --save-dev vitest @benzene/testing @benzene/aws-lambda-testing
```

`vitest` is the test runner (its `vi.fn()` gives you spies for verifying calls); `@benzene/testing`
provides the `messageBuilder`/`httpBuilder` request builders, and `@benzene/aws-lambda-testing` turns
those into native cloud events (`asApiGatewayRequest`, `asSqs`, …).

## The approach

The TypeScript port ships `benzeneTestHost(StartUp)` — the port of .NET's `BenzeneTestHost` — which builds an
in-memory host from your production `BenzeneStartUp` and lets you override any registration with
`.withServices(...)` (last-registration-wins), then finishes with a single `.buildAwsLambdaHost()` /
`.buildAzureFunctionApp()` line. So the TypeScript way to "swap in a mock" is:

1. `benzeneTestHost(YourStartUp)`.
2. `.withServices((services) => services.addSingletonInstance(IYourDep, fake))` — the fake wins over the
   startup's own registration of the **same service identifier** the handler injects.
3. `.buildAwsLambdaHost()`, then `host.sendEventAsync(asX(...))` a real event through it and assert on the
   response and on the fake.

(For a low-level unit test that deliberately bypasses a startup class, you can still build a transport
entry point directly with `InlineAwsLambdaStartUp` / a hand-built pipeline.)

Because the container resolves the **most recent** registration for an identifier
(`Microsoft.Extensions.DependencyInjection` semantics), registering a fake *after* the real dependency
overrides it — but in a focused handler test you usually just register the fake and nothing else.

## Step-by-Step Implementation

### 1. A dependency behind a service token

An injected dependency is an interface with a merged `ServiceToken` constant of the same name (the port's
convention for anything resolved from the container — TypeScript erases types, so the token is the runtime
identifier):

```ts
// OrderService.ts
import { IBenzeneResultOf, ServiceToken, serviceToken } from '@benzene/abstractions';

export class OrderDto {
  id?: string;
  status?: string;
}

export interface IOrderService {
  getAsync(id: string): Promise<IBenzeneResultOf<OrderDto>>;
}

// The interface and the constant share a name (declaration merging) — `IOrderService` is both the type
// and the runtime identifier the container resolves.
export const IOrderService: ServiceToken<IOrderService> = serviceToken<IOrderService>('IOrderService');
```

### 2. A handler with that dependency

```ts
// GetOrderHandler.ts
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { IOrderService, OrderDto } from './OrderService.js';

export class GetOrderMessage {
  id?: string;
}

@httpEndpoint('POST', '/orders/lookup')
@message('order:get', { requestType: GetOrderMessage, responseType: OrderDto })
export class GetOrderHandler implements IMessageHandler<GetOrderMessage, OrderDto> {
  static readonly inject = [IOrderService] as const;

  constructor(private readonly orderService: IOrderService) {}

  handleAsync(message: GetOrderMessage): Promise<IBenzeneResultOf<OrderDto>> {
    return this.orderService.getAsync(message.id!);
  }
}
```

The `static readonly inject = [IOrderService] as const` array is how the handler declares its constructor
dependencies: the container resolves each identifier and passes it in order. (A class with constructor
parameters but no `inject` array can't be resolved — the container throws a teaching error naming the fix.)

### 3. Build the pipeline with the dependency mocked

Boot the same `StartUp` you deploy, override `IOrderService` with a `vi.fn()`-backed fake via
`.withServices(...)`, drive a real API Gateway event through the host, and assert on both the response and
the spy. First the production composition root — the `StartUp` the test boots:

```ts
// src/startUp.ts — the same composition root you deploy.
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzene/core-message-handlers';
import { useAwsLambda } from '@benzene/aws-lambda-core';
import { useApiGateway } from '@benzene/aws-lambda-api-gateway';
import { GetOrderHandler } from './GetOrderHandler.js';

export class GetOrderStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
    // ... your production IOrderService registration goes here
  }

  configure(app: IBenzeneApplicationBuilder): void {
    useAwsLambda(app, (aws) => useApiGateway(aws, (api) => useMessageHandlers(api, GetOrderHandler)));
  }
}
```

```ts
// GetOrderHandler.test.ts
import { describe, expect, it, vi } from 'vitest';
import { APIGatewayProxyResult } from 'aws-lambda';
import { BenzeneResult } from '@benzene/results';
import { benzeneTestHost, httpBuilder } from '@benzene/testing';
import { asApiGatewayRequest } from '@benzene/aws-lambda-testing';
import { GetOrderStartUp } from '../src/startUp.js';
import { IOrderService, OrderDto } from '../src/OrderService.js';

describe('GetOrderHandler', () => {
  it('returns the order from the service, through the real pipeline', async () => {
    // Arrange: a fake dependency with a spy.
    const dto = new OrderDto();
    dto.id = '123';
    dto.status = 'placed';

    const getAsync = vi.fn().mockResolvedValue(BenzeneResult.ok(dto));
    const orderService: IOrderService = { getAsync };

    // Boot the SAME StartUp you deploy, overriding IOrderService with the fake (last-registration-wins).
    const host = benzeneTestHost(GetOrderStartUp)
      .withServices((services) => services.addScopedInstance(IOrderService, orderService))
      .buildAwsLambdaHost();

    // Act: send a real HTTP event through the whole pipeline (routing, body binding, response render).
    const event = asApiGatewayRequest(httpBuilder('POST', '/orders/lookup', { id: '123' }));
    const response = await host.sendEventAsync<APIGatewayProxyResult>(event);

    // Assert: on the response ...
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ id: '123', status: 'placed' });

    // ... and on how the dependency was used.
    expect(getAsync).toHaveBeenCalledWith('123');
    expect(getAsync).toHaveBeenCalledTimes(1);
  });
});
```

`addScopedInstance(IOrderService, orderService)` registers the exact fake object under the handler's
injected identifier; the message still flows through the real routing, body binding, and response
rendering, so the test reflects production. `asApiGatewayRequest(httpBuilder(...))` builds a realistic
`APIGatewayProxyEvent` — swap it for `asSqs(messageBuilder(...))` (and `useSqs`) if your handler is hosted
on SQS instead. Note the [request-binding caveat](../message-handlers.md): the port binds the JSON **body**
onto the request, so send `id` in the body rather than as a `/{id}` path segment.

### 4. Override a real registration (optional)

When your `StartUp` already registers the real `IOrderService`, `.withServices(...)` runs **after** the
startup's own `configureServices`, so the fake it registers wins — the container resolves the most recent
registration for an identifier:

```ts
// In the production StartUp's configureServices:
services.addScoped(IOrderService, RealOrderService); // production registration

// In the test — layered on top, last wins:
benzeneTestHost(GetOrderStartUp)
  .withServices((services) => services.addScopedInstance(IOrderService, orderService)) // test override
  .buildAwsLambdaHost();
```

## Troubleshooting

### The real dependency is still used

The container resolves the **last** registration for an identifier. Register the fake against the **same**
identifier the handler injects (`IOrderService`, the token — not a differently-named one), after any real
registration. Confirm the handler's `static inject` lists that identifier.

### `BenzeneException: … declares N constructor parameter(s) but no static \`inject\` array`

The handler has constructor parameters but no `static inject` array, so the container can't resolve them
(TypeScript erases parameter types — there is no reflective constructor injection). Add
`static readonly inject = [IOrderService] as const` listing the dependencies in constructor order.

### The response is 404 instead of your handler's result

The event didn't route to your handler. For API Gateway, the `@httpEndpoint` method/path must match the
event (`asApiGatewayRequest(httpBuilder('POST', '/orders/lookup', …))`); for a topic transport, the
`topic` message attribute must match your `@message('order:get')`.

## Variations

### Fakes instead of spies

Nothing requires `vi.fn()` — register a hand-written in-memory fake (e.g. an `InMemoryOrderService`) via
`addScopedInstance` just the same, and assert on its recorded state. Benzene's own tests use in-memory
implementations this way.

### Test the service, not the handler

If your handler is thin (delegating to a service, as recommended in
[Message Handlers](../message-handlers.md)), you can also unit-test the service directly with no pipeline
at all — reserve the entry-point approach for verifying the handler *and pipeline* (routing, validation,
serialization) together.

### Assert on the result without a transport

To check a handler's result directly rather than a transport-native response, drive a
`MiddlewarePipelineBuilder` by hand and capture the context in an `onResponse` step — this is the shape the
`SqsApplication`/`SnsApplication` package tests use. It needs no cloud event at all, at the cost of not
exercising the transport's request/response mapping.

## Further Reading

- [Testing Benzene](../testing-benzene.md) — the complete testing guide.
- [Message Handlers](../message-handlers.md) — why handlers stay thin, and the `static inject` convention.
- [Message Results](../message-result.md) — `IBenzeneResultOf<T>`, the `BenzeneResult` factory, and
  transport mapping.
- [Handling SQS Message Failures](handling-sqs-failures.md) — faking a flaky dependency to exercise
  retry/DLQ behavior.

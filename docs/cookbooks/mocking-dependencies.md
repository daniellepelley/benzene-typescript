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

The .NET library ships a `BenzeneTestHost` that builds an in-memory host from your production `StartUp` and
lets you override registrations with `WithServices(...)`. **The TypeScript port does not port that host** —
under type erasure the transports are driven directly via their entry points (`InlineAwsLambdaStartUp`) or
a pipeline built by hand, which is exactly what the ported tests do. So the TypeScript way to "swap in a
mock" is:

1. Build the entry point (or pipeline) in the test.
2. In `configureServices`, register your fake against the **same service identifier** the handler injects.
3. Drive a real event through it and assert.

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

Register a `vi.fn()`-backed fake for `IOrderService` in `configureServices`, drive a real API Gateway event
through the entry point, and assert on both the response and the spy:

```ts
// GetOrderHandler.test.ts
import { describe, expect, it, vi } from 'vitest';
import { APIGatewayProxyResult, Context } from 'aws-lambda';
import { BenzeneResult } from '@benzene/results';
import { addBenzene, useMessageHandlers } from '@benzene/core-message-handlers';
import { InlineAwsLambdaStartUp } from '@benzene/aws-lambda-core';
import { useApiGateway } from '@benzene/aws-lambda-api-gateway';
import { httpBuilder } from '@benzene/testing';
import { asApiGatewayRequest } from '@benzene/aws-lambda-testing';
import { GetOrderHandler } from '../src/GetOrderHandler.js';
import { IOrderService, OrderDto } from '../src/OrderService.js';

const fakeLambdaContext = {} as Context;

describe('GetOrderHandler', () => {
  it('returns the order from the service, through the real pipeline', async () => {
    // Arrange: a fake dependency with a spy.
    const dto = new OrderDto();
    dto.id = '123';
    dto.status = 'placed';

    const getAsync = vi.fn().mockResolvedValue(BenzeneResult.ok(dto));
    const orderService: IOrderService = { getAsync };

    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((services) => {
        addBenzene(services);
        // Register the fake against the SAME identifier the handler injects.
        services.addScopedInstance(IOrderService, orderService);
      })
      .configure((app) => useApiGateway(app, (api) => useMessageHandlers(api, GetOrderHandler)))
      .build();

    // Act: send a real HTTP event through the whole pipeline (routing, body binding, response render).
    const event = asApiGatewayRequest(httpBuilder('POST', '/orders/lookup', { id: '123' }));
    const response = (await entryPoint.functionHandlerAsync(
      event,
      fakeLambdaContext,
    )) as APIGatewayProxyResult;

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

If you want to build from a shared startup that already registers the real `IOrderService` and only swap
it in the test, register the fake **after** it — the container resolves the most recent registration:

```ts
.configureServices((services) => {
  addBenzene(services);
  services.addScoped(IOrderService, RealOrderService); // production registration
  services.addScopedInstance(IOrderService, orderService); // test override — last wins
})
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

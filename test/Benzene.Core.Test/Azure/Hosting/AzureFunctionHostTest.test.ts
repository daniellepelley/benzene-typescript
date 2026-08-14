/**
 * Proves the one-liner boot `const host = new AzureFunctionHost(StartUp)` +
 * `app.http('orders', { handler: host.httpFunction })` is equivalent to the old hand-built `azureApp(...)`
 * assembly. The Azure counterpart of `AwsLambdaHostTest`: two unified `BenzeneStartUp`s — an HTTP one and a
 * fire-and-forget Service Bus one — each booted with `new AzureFunctionHost(StartUp)`, then driven through
 * the host's native-trigger getter (`.httpFunction` / `.serviceBusFunction`) exactly as the
 * `@azure/functions` runtime would.
 *
 * The StartUps read IDENTICALLY to the AWS ones — same `configureServices`/`configure` shape, same
 * `useMessageHandlers(...)` inner wiring — only the transport verb differs
 * (`useAzureFunctions(app, az => useAzureHttp(az, …))` vs `useAwsLambda(app, aws => useApiGateway(aws, …))`).
 */
import { describe, expect, it } from 'vitest';
import { HttpResponseInit } from '@azure/functions';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneConfiguration, BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import { BenzeneException } from '@benzenejs/core';
import { addBenzene, message, MessageHandlersRegistry, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { httpEndpoint } from '@benzenejs/http';
import { AzureFunctionHost, useAzureFunctions } from '@benzenejs/azure-function-core';
import { useAzureHttp } from '@benzenejs/azure-function-http';
import { useServiceBus } from '@benzenejs/azure-function-service-bus';
import { httpBuilder, messageBuilder } from '@benzenejs/testing';
import { asAzureHttpRequest, asAzureServiceBusMessage } from '@benzenejs/azure-function-testing';

class Order {
  orderId?: string;
}
class OrderCreated {
  reference?: string;
}

// Records what actually reached the handler, so each assertion proves the event genuinely routed.
const handled: string[] = [];

// A private registry so decorating this handler does not leak into the global registry used by other tests.
const registry = new MessageHandlersRegistry();

@httpEndpoint('POST', '/orders')
@message('create-order', { registry, requestType: Order, responseType: OrderCreated })
class CreateOrderHandler implements IMessageHandler<Order, OrderCreated> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderCreated>> {
    handled.push(request.orderId ?? '<none>');
    const payload = new OrderCreated();
    payload.reference = `ref-${request.orderId}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

// The composition root a real deployment would ship in `src/startUp.ts` — the canonical `BenzeneStartUp`
// shape both this host and `benzeneTestHost` boot from. This one wires the HTTP trigger.
class HttpStartUp implements BenzeneStartUp {
  getConfiguration(): BenzeneConfiguration {
    return { get: (key) => process.env[key] };
  }

  configureServices(services: IBenzeneServiceContainer, _configuration: BenzeneConfiguration): void {
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder, _configuration: BenzeneConfiguration): void {
    useAzureFunctions(app, (az) => useAzureHttp(az, (http) => useMessageHandlers(http, CreateOrderHandler)));
  }
}

// The same shape, wired instead for a fire-and-forget (Service Bus) trigger — its own host / container.
class ServiceBusStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _configuration: BenzeneConfiguration): void {
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder, _configuration: BenzeneConfiguration): void {
    useAzureFunctions(app, (az) => useServiceBus(az, (sb) => useMessageHandlers(sb, CreateOrderHandler)));
  }
}

describe('AzureFunctionHost (the one-liner boot)', () => {
  it('routes an HTTP request through host.httpFunction to the decorated handler', async () => {
    handled.length = 0;
    // The exact shape a deployment registers: `app.http('orders', { handler: host.httpFunction })`.
    const httpFunction = new AzureFunctionHost(HttpStartUp).httpFunction;

    const response = (await httpFunction(
      asAzureHttpRequest(httpBuilder('POST', '/orders', { orderId: '42' })),
    )) as HttpResponseInit;

    // The handler genuinely ran with the deserialized body, and the HTTP result mapped Ok -> 200.
    expect(handled).toEqual(['42']);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body as string)).toEqual({ reference: 'ref-42' });
  });

  it('httpFunction stays bound when detached (the const handler = host.httpFunction idiom)', async () => {
    handled.length = 0;
    const detached = new AzureFunctionHost(HttpStartUp).httpFunction;

    const response = (await detached(
      asAzureHttpRequest(httpBuilder('POST', '/orders', { orderId: '1' })),
    )) as HttpResponseInit;

    expect(response.status).toBe(200);
    expect(handled).toEqual(['1']);
  });

  it('routes a fire-and-forget (Service Bus) batch through host.serviceBusFunction to the handler', async () => {
    handled.length = 0;
    const serviceBusFunction = new AzureFunctionHost(ServiceBusStartUp).serviceBusFunction;

    await serviceBusFunction([
      asAzureServiceBusMessage(messageBuilder('create-order', { orderId: '7' })),
      asAzureServiceBusMessage(messageBuilder('create-order', { orderId: '8' })),
    ]);

    // Both Service Bus messages routed to the handler.
    expect(handled).toEqual(['7', '8']);
  });

  it('handleAsyncWithResult throws BenzeneException when no request entry point is registered', async () => {
    // A Service Bus host registers only a fire-and-forget app, so a request that expects a response finds
    // no matching entry point — the same self-diagnosing contract as the hand-built app.
    const host = new AzureFunctionHost(ServiceBusStartUp);

    // The dispatcher raises synchronously (it throws before returning a promise), matching `AzureFunctionApp`.
    expect(() => host.handleAsyncWithResult({ orderId: 'x' })).toThrow(BenzeneException);
  });
});

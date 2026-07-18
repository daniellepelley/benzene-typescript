import { describe, expect, it } from 'vitest';
import { HttpRequest, HttpResponseInit } from '@azure/functions';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { BenzeneResult } from '@benzene/results';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { InlineAzureFunctionStartUp } from '@benzene/azure-function-core';
import {
  addAzureHttp,
  AzureHttpApplication,
  AzureHttpContext,
  handleHttpRequest,
  useAzureHttp,
} from '@benzene/azure-function-http';

/**
 * End-to-end port of the C# AspNet HTTP pipeline tests, retargeted onto the @azure/functions v4 HTTP
 * model: wire the full stack via idiomatic DI and feed a realistic @azure/functions HttpRequest through
 * the request-mapping -> routing -> response-rendering chain, asserting the returned HttpResponseInit's
 * status and body. HTTP is request/response (WithResult), like AWS API Gateway.
 */

class Order {
  orderId: string | undefined;
}

class OrderCreated {
  reference: string | undefined;
}

const handled: string[] = [];

// A private registry so decorating this handler does not leak into the global registry used by other
// tests; passing the class explicitly to `useMessageHandlers` reads its `@message` metadata directly.
const registry = new MessageHandlersRegistry();

// `@httpEndpoint` (the port of C# `[HttpEndpoint]`) maps POST /orders -> this handler's topic; the
// route finder correlates the endpoint with the `@message('create-order')` topic.
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

// A realistic @azure/functions HttpRequest: the test-only constructor accepts method/url/headers/body.
// `url` carries the path the route finder matches; the body is a JSON string the request mapper reads.
function createHttpRequest(method: string, path: string, body: unknown): HttpRequest {
  return new HttpRequest({
    method,
    url: `http://localhost${path}`,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : { string: JSON.stringify(body) },
  });
}

describe('AzureHttpPipeline (via AzureFunctionApp entry point)', () => {
  it('routes an HTTP request to a decorated handler and returns 200 with the serialized body', async () => {
    handled.length = 0;

    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useAzureHttp(builder, (http) => useMessageHandlers(http, CreateOrderHandler)),
      )
      .build();

    const request = createHttpRequest('POST', '/orders', { orderId: '42' });

    const response: HttpResponseInit = await handleHttpRequest(app, request);

    // The handler genuinely ran with the deserialized body...
    expect(handled).toEqual(['42']);
    // ...the HTTP status maps from Ok -> 200...
    expect(response.status).toBe(200);
    // ...and the body is the handler's serialized response.
    expect(JSON.parse(response.body as string)).toEqual({ reference: 'ref-42' });
    expect((response.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('returns 404 for an unknown route (no matching topic)', async () => {
    handled.length = 0;

    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useAzureHttp(builder, (http) => useMessageHandlers(http, CreateOrderHandler)),
      )
      .build();

    const request = createHttpRequest('GET', '/no-such-route', undefined);

    const response: HttpResponseInit = await handleHttpRequest(app, request);

    // Nothing handled the request; the not-found status maps to HTTP 404.
    expect(handled).toEqual([]);
    expect(response.status).toBe(404);
  });
});

describe('AzureHttpApplication (direct)', () => {
  it('maps a request through the pipeline into an HttpResponseInit', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addAzureHttp(container);

    const builder = new MiddlewarePipelineBuilder<AzureHttpContext>(container);
    useMessageHandlers(builder, CreateOrderHandler);

    const application = new AzureHttpApplication(
      builder.build(),
      container.createServiceResolverFactory(),
    );
    const request = createHttpRequest('POST', '/orders', { orderId: '7' });
    const body = await request.text();

    const response = await application.sendAsync({ request, body });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body as string)).toEqual({ reference: 'ref-7' });
  });
});

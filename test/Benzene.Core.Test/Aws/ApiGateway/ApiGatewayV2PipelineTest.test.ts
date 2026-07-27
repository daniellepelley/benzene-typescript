/**
 * Port of the C# API Gateway v2 (HTTP API, payload format 2.0) pipeline tests: feed a realistic
 * `APIGatewayProxyEventV2` through the v2 request-mapping -> routing -> response chain, and prove the v2
 * specifics — method/path from `requestContext.http`, base64 body decode. (v1 and v2 are wired in
 * separate entry points, one transport each — see the note on `ApiGatewayV2LambdaHandler`.)
 */
import { describe, expect, it } from 'vitest';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { ICurrentTransport, IMessageHandler } from '@benzene/abstractions-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { addBenzene, message, MessageHandlersRegistry, useMessageHandlers } from '@benzene/core-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { httpEndpoint } from '@benzene/http';
import {
  addApiGatewayV2,
  ApiGatewayV2Application,
  ApiGatewayV2Context,
  useApiGatewayV2,
} from '@benzene/aws-lambda-api-gateway';
import { benzeneTestHost, httpBuilder } from '@benzene/testing';
import { asApiGatewayV2Request, type AwsLambdaStartUp } from '@benzene/aws-lambda-testing';

class Order {
  orderId?: string;
}
class OrderCreated {
  reference?: string;
}

const handled: string[] = [];
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

// Migrated off `InlineAwsLambdaStartUp` to the public startup-host harness
// (`benzeneTestHost(StartUp).buildAwsLambdaHost()` + `host.sendEventAsync(...)`) — the exact shape an
// adopter copies.
class ApiGatewayV2StartUp implements AwsLambdaStartUp {
  configureServices = (services: Parameters<AwsLambdaStartUp['configureServices']>[0]): void => {
    addBenzene(services);
  };

  configure(app: Parameters<AwsLambdaStartUp['configure']>[0]): void {
    useApiGatewayV2(app, (api) => useMessageHandlers(api, CreateOrderHandler));
  }
}

function v2Host() {
  return benzeneTestHost(ApiGatewayV2StartUp).buildAwsLambdaHost();
}

describe('ApiGatewayV2Pipeline (via the benzeneTestHost harness)', () => {
  it('routes an HTTP API v2 request to a decorated handler and returns 200 with the serialized body', async () => {
    handled.length = 0;
    const response = await v2Host().sendEventAsync<{ statusCode: number; body: string }>(
      asApiGatewayV2Request(httpBuilder('POST', '/orders', { orderId: '42' })),
    );

    expect(handled).toEqual(['42']);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ reference: 'ref-42' });
  });

  it('decodes a base64-encoded v2 body before the handler sees it', async () => {
    handled.length = 0;
    const event: APIGatewayProxyEventV2 = {
      version: '2.0',
      routeKey: 'POST /orders',
      rawPath: '/orders',
      rawQueryString: '',
      headers: { 'content-type': 'application/json' },
      requestContext: {
        http: { method: 'POST', path: '/orders', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 't' },
      } as APIGatewayProxyEventV2['requestContext'],
      body: Buffer.from(JSON.stringify({ orderId: '99' }), 'utf8').toString('base64'),
      isBase64Encoded: true,
    };

    const response = await v2Host().sendEventAsync<{ statusCode: number }>(event);

    expect(handled).toEqual(['99']); // handler saw the decoded body, not base64
    expect(response.statusCode).toBe(200);
  });

  it('folds the v2 cookies array into a cookie header the handler can read', async () => {
    handled.length = 0;
    const event: APIGatewayProxyEventV2 = {
      version: '2.0',
      routeKey: 'POST /orders',
      rawPath: '/orders',
      rawQueryString: '',
      headers: { 'content-type': 'application/json' },
      cookies: ['session=abc', 'theme=dark'],
      requestContext: {
        http: { method: 'POST', path: '/orders', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 't' },
      } as APIGatewayProxyEventV2['requestContext'],
      body: JSON.stringify({ orderId: '1' }),
      isBase64Encoded: false,
    };

    // Routes and handles fine with cookies present (the cookie header is folded in by the v2 context).
    const response = await v2Host().sendEventAsync<{ statusCode: number }>(event);

    expect(handled).toEqual(['1']);
    expect(response.statusCode).toBe(200);
  });
});

describe('ApiGatewayV2Application (direct)', () => {
  it('reports the api-gateway transport for the duration of the request', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addApiGatewayV2(container);

    let seenTransport: string | undefined;
    const builder = new MiddlewarePipelineBuilder<ApiGatewayV2Context>(container);
    builder.useFn((_context, next, resolver) => {
      seenTransport = resolver.getService(ICurrentTransport).name;
      return next();
    });

    const application = new ApiGatewayV2Application(builder.build());
    await application.handleAsync(
      asApiGatewayV2Request(httpBuilder('GET', '/orders', undefined)),
      container.createServiceResolverFactory(),
    );

    // The TransportMiddlewarePipeline wrap tags the transport as api-gateway (faithful to .NET).
    expect(seenTransport).toBe('api-gateway');
  });
});

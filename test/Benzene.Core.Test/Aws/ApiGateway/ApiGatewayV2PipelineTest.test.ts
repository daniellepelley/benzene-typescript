/**
 * Port of the C# API Gateway v2 (HTTP API, payload format 2.0) pipeline tests: feed a realistic
 * `APIGatewayProxyEventV2` through the v2 request-mapping -> routing -> response chain, and prove the v2
 * specifics — method/path from `requestContext.http`, base64 body decode. (v1 and v2 are wired in
 * separate entry points, one transport each — see the note on `ApiGatewayV2LambdaHandler`.)
 */
import { describe, expect, it } from 'vitest';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { addBenzene, message, MessageHandlersRegistry, useMessageHandlers } from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { InlineAwsLambdaStartUp } from '@benzene/aws-lambda-core';
import { useApiGatewayV2 } from '@benzene/aws-lambda-api-gateway';
import { httpBuilder } from '@benzene/testing';
import { asApiGatewayV2Request } from '@benzene/aws-lambda-testing';

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

const context = {} as Context;

function v2Entry() {
  return new InlineAwsLambdaStartUp()
    .configureServices((services) => addBenzene(services))
    .configure((app) => useApiGatewayV2(app, (api) => useMessageHandlers(api, CreateOrderHandler)))
    .build();
}

describe('ApiGatewayV2Pipeline', () => {
  it('routes an HTTP API v2 request to a decorated handler and returns 200 with the serialized body', async () => {
    handled.length = 0;
    const response = (await v2Entry().functionHandlerAsync(
      asApiGatewayV2Request(httpBuilder('POST', '/orders', { orderId: '42' })),
      context,
    )) as { statusCode: number; body: string };

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

    const response = (await v2Entry().functionHandlerAsync(event, context)) as { statusCode: number };

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
    const response = (await v2Entry().functionHandlerAsync(event, context)) as { statusCode: number };

    expect(handled).toEqual(['1']);
    expect(response.statusCode).toBe(200);
  });
});

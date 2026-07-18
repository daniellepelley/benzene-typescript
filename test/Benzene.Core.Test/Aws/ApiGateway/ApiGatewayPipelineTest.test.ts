import { describe, expect, it } from 'vitest';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
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
import { InlineAwsLambdaStartUp } from '@benzene/aws-lambda-core';
import {
  addApiGateway,
  ApiGatewayApplication,
  ApiGatewayContext,
  useApiGateway,
} from '@benzene/aws-lambda-api-gateway';

/**
 * End-to-end port of the C# API Gateway pipeline tests
 * (test/Benzene.Core.Test/Aws/ApiGateway/ApiGatewayMessagePipelineTest.cs): wire the full stack via
 * idiomatic DI and feed a realistic APIGatewayProxyEvent through the request-mapping -> routing ->
 * response-rendering chain, asserting the returned APIGatewayProxyResult's statusCode and body.
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

function createApiGatewayEvent(
  httpMethod: string,
  path: string,
  body: unknown,
): APIGatewayProxyEvent {
  return {
    httpMethod,
    path,
    resource: path,
    body: body === undefined ? null : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    isBase64Encoded: false,
    // requestContext is required by the type; only its presence matters here.
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
  };
}

const fakeLambdaContext = {} as Context;

describe('ApiGatewayPipeline (via AwsLambdaEntryPoint)', () => {
  it('routes an HTTP request to a decorated handler and returns 200 with the serialized body', async () => {
    handled.length = 0;

    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((app) => useApiGateway(app, (api) => useMessageHandlers(api, CreateOrderHandler)))
      .build();

    const event = createApiGatewayEvent('POST', '/orders', { orderId: '42' });

    const response = (await entryPoint.functionHandlerAsync(
      event,
      fakeLambdaContext,
    )) as APIGatewayProxyResult;

    // The handler genuinely ran with the deserialized body...
    expect(handled).toEqual(['42']);
    // ...the HTTP status maps from Ok -> 200...
    expect(response.statusCode).toBe(200);
    // ...and the body is the handler's serialized response.
    expect(JSON.parse(response.body)).toEqual({ reference: 'ref-42' });
    expect(response.headers?.['content-type']).toBe('application/json');
  });

  it('returns 404 for an unknown route (no matching topic)', async () => {
    handled.length = 0;

    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((app) => useApiGateway(app, (api) => useMessageHandlers(api, CreateOrderHandler)))
      .build();

    const event = createApiGatewayEvent('GET', '/no-such-route', undefined);

    const response = (await entryPoint.functionHandlerAsync(
      event,
      fakeLambdaContext,
    )) as APIGatewayProxyResult;

    // Nothing handled the request; the not-found status maps to HTTP 404.
    expect(handled).toEqual([]);
    expect(response.statusCode).toBe(404);
  });
});

describe('ApiGatewayApplication (direct)', () => {
  it('maps an event through the pipeline into an APIGatewayProxyResult', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addApiGateway(container);

    const builder = new MiddlewarePipelineBuilder<ApiGatewayContext>(container);
    useMessageHandlers(builder, CreateOrderHandler);

    const application = new ApiGatewayApplication(builder.build());
    const event = createApiGatewayEvent('POST', '/orders', { orderId: '7' });

    const response = await application.handleAsync(event, container.createServiceResolverFactory());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ reference: 'ref-7' });
  });
});

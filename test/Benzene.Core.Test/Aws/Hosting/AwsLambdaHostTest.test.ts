/**
 * Proves the one-liner boot `export const handler = new AwsLambdaHost(StartUp).lambdaHandler` is
 * equivalent to the old hand-built `handler.ts` pipeline assembly. TypeScript-idiomatic analog of C#'s
 * `AwsLambdaBootstrapTest.RunAsync_OfStartUp_HostsAndRunsToCompletion` (test/Benzene.Core.Test/Aws/
 * Hosting/AwsLambdaBootstrapTest.cs): the .NET test drives the custom-runtime `AwsLambdaBootstrap` loop
 * (a .NET-runtime-only concept — Node's runtime invokes an exported `handler` instead), so here we
 * construct the host, take its `lambdaHandler`, and invoke it directly with real events.
 *
 * Two StartUps — an HTTP one (API Gateway) and a non-HTTP one (SQS) — each booted with the one-liner
 * `new AwsLambdaHost(StartUp)`, proving the host boots and routes for both an HTTP and a non-HTTP
 * trigger. (The port's one-transport-per-container rule means each transport is its own host/entry point;
 * see `MultipleTransportsInOneProcessTest`.)
 */
import { describe, expect, it } from 'vitest';
import { APIGatewayProxyResult, Context, SQSBatchResponse } from 'aws-lambda';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneConfiguration, BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import { BenzeneException } from '@benzenejs/core';
import { addBenzene, message, MessageHandlersRegistry, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { httpEndpoint } from '@benzenejs/http';
import { AwsLambdaHost, useAwsLambda } from '@benzenejs/aws-lambda-core';
import { useApiGateway } from '@benzenejs/aws-lambda-api-gateway';
import { useSqs } from '@benzenejs/aws-lambda-sqs';
import { httpBuilder, messageBuilder } from '@benzenejs/testing';
import { asApiGatewayRequest, asSqs } from '@benzenejs/aws-lambda-testing';

class Order {
  orderId?: string;
}
class OrderCreated {
  reference?: string;
}

// Records what actually reached the handler, so each assertion proves the event genuinely routed.
const handled: string[] = [];

// A private registry so decorating this handler does not leak into the global registry used by other
// tests; passing the class explicitly to `useMessageHandlers` reads its `@message` metadata directly.
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
// shape (`getConfiguration` / `configureServices` / `configure`) both this host and `benzeneTestHost`
// boot from. This one wires the HTTP (API Gateway) trigger.
class ApiGatewayStartUp implements BenzeneStartUp {
  getConfiguration(): BenzeneConfiguration {
    return { get: (key) => process.env[key] };
  }

  configureServices(services: IBenzeneServiceContainer, _configuration: BenzeneConfiguration): void {
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder, _configuration: BenzeneConfiguration): void {
    useAwsLambda(app, (aws) => useApiGateway(aws, (api) => useMessageHandlers(api, CreateOrderHandler)));
  }
}

// The same shape, wired instead for a non-HTTP (SQS) trigger — its own host / container.
class SqsStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _configuration: BenzeneConfiguration): void {
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder, _configuration: BenzeneConfiguration): void {
    useAwsLambda(app, (aws) => useSqs(aws, (sqs) => useMessageHandlers(sqs, CreateOrderHandler)));
  }
}

const context = {} as Context;
const noopCallback = () => undefined;

describe('AwsLambdaHost (the one-liner boot)', () => {
  it('routes an API Gateway event through lambdaHandler to the decorated handler', async () => {
    handled.length = 0;
    // The exact shape a deployment exports: `export const handler = new AwsLambdaHost(StartUp).lambdaHandler`.
    const handler = new AwsLambdaHost(ApiGatewayStartUp).lambdaHandler;

    const response = (await handler(
      asApiGatewayRequest(httpBuilder('POST', '/orders', { orderId: '42' })),
      context,
      noopCallback,
    )) as APIGatewayProxyResult;

    // The handler genuinely ran with the deserialized body, and the HTTP result mapped Ok -> 200.
    expect(handled).toEqual(['42']);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ reference: 'ref-42' });
  });

  it('routes a non-HTTP (SQS) event through its host to the decorated handler', async () => {
    handled.length = 0;
    const handler = new AwsLambdaHost(SqsStartUp).lambdaHandler;

    const response = (await handler(
      asSqs(messageBuilder('create-order', { orderId: '7' })),
      context,
      noopCallback,
    )) as SQSBatchResponse;

    // The SQS record routed to the handler, and no record was reported as failed.
    expect(handled).toEqual(['7']);
    expect(response.batchItemFailures).toEqual([]);
  });

  it('lambdaHandler stays bound when detached (the export const handler = ... idiom)', async () => {
    handled.length = 0;
    // Detach exactly as `export const handler = new AwsLambdaHost(StartUp).lambdaHandler` does.
    const handler = new AwsLambdaHost(ApiGatewayStartUp).lambdaHandler;
    const detached = handler;

    const response = (await detached(
      asApiGatewayRequest(httpBuilder('POST', '/orders', { orderId: '1' })),
      context,
      noopCallback,
    )) as APIGatewayProxyResult;

    expect(response.statusCode).toBe(200);
    expect(handled).toEqual(['1']);
  });

  it('functionHandlerAsync throws BenzeneException when no router recognizes the event', async () => {
    const host = new AwsLambdaHost(SqsStartUp);

    // An event no router claims leaves `context.response` undefined, so the entry point raises the
    // recognition error — same contract as the hand-built entry point.
    await expect(host.functionHandlerAsync({ foo: 'bar' }, context)).rejects.toThrow(BenzeneException);
  });
});

/**
 * Pins the AWS Lambda handler-binding fix: `toLambdaHandler(entryPoint)` returns a closure bound to the
 * entry point, so the idiomatic `export const handler = toLambdaHandler(entryPoint)` works when AWS calls
 * the detached function. Also demonstrates the trap it removes: assigning the bare method
 * (`const handler = entryPoint.functionHandlerAsync`) detaches `this` and throws at invocation.
 */
import { describe, expect, it } from 'vitest';
import { Context } from 'aws-lambda';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { addBenzene, message, MessageHandlersRegistry, useMessageHandlers } from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { InlineAwsLambdaStartUp, toLambdaHandler } from '@benzene/aws-lambda-core';
import { useApiGateway } from '@benzene/aws-lambda-api-gateway';
import { httpBuilder } from '@benzene/testing';
import { asApiGatewayRequest } from '@benzene/aws-lambda-testing';

class Order {
  orderId?: string;
}
class OrderCreated {
  reference?: string;
}

const registry = new MessageHandlersRegistry();

@httpEndpoint('POST', '/orders')
@message('create-order', { registry, requestType: Order, responseType: OrderCreated })
class CreateOrderHandler implements IMessageHandler<Order, OrderCreated> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderCreated>> {
    const payload = new OrderCreated();
    payload.reference = `ref-${request.orderId}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

function buildEntryPoint() {
  return new InlineAwsLambdaStartUp()
    .configureServices((services) => addBenzene(services))
    .configure((app) => useApiGateway(app, (api) => useMessageHandlers(api, CreateOrderHandler)))
    .build();
}

const event = asApiGatewayRequest(httpBuilder('POST', '/orders', { orderId: '42' }));
const context = {} as Context;
const noopCallback = () => undefined;

describe('toLambdaHandler', () => {
  it('produces a handler that works when detached (the export const handler = ... idiom)', async () => {
    const entryPoint = buildEntryPoint();
    const handler = toLambdaHandler(entryPoint); // detached, exactly as `export const handler = ...`

    const response = (await handler(event, context, noopCallback)) as { statusCode: number; body: string };

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ reference: 'ref-42' });
  });

  it('the naive bare-method assignment loses `this` and throws (the trap this helper removes)', async () => {
    const entryPoint = buildEntryPoint();
    const naive = entryPoint.functionHandlerAsync; // detaches `this`

    await expect(naive(event, context)).rejects.toThrow();
  });
});

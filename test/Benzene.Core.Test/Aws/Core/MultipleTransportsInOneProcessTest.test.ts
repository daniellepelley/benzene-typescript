/**
 * Answers "can you run multiple transports at the same time in TypeScript?" — YES. Multiple transports run
 * concurrently in ONE Node process by giving each its own entry point (its own DI container), exactly as a
 * self-hosted service would run an HTTP server alongside a queue consumer. They share nothing at the DI
 * level, so there is no cross-talk; the only thing you cannot do today is put two transports in ONE
 * container (their message getters register under the same erased token and overwrite each other — the
 * one-transport-per-entry-point rule).
 *
 * This test builds an API Gateway entry point and an SQS entry point in the same process, fires them
 * concurrently, and asserts both route correctly and independently.
 */
import { describe, expect, it } from 'vitest';
import { Context } from 'aws-lambda';
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import { addBenzene, message, MessageHandlersRegistry, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { httpEndpoint } from '@benzenejs/http';
import { InlineAwsLambdaStartUp, toLambdaHandler } from '@benzenejs/aws-lambda-core';
import { useApiGateway } from '@benzenejs/aws-lambda-api-gateway';
import { useSqs } from '@benzenejs/aws-lambda-sqs';
import { httpBuilder, messageBuilder } from '@benzenejs/testing';
import { asApiGatewayRequest, asSqs } from '@benzenejs/aws-lambda-testing';

// Two handlers on separate topics so we can see which transport routed to which.
const httpHandled: string[] = [];
const queueHandled: string[] = [];
const registry = new MessageHandlersRegistry();

class Order {
  orderId?: string;
}
class OrderResult {
  reference?: string;
}

@httpEndpoint('POST', '/orders')
@message('order:http', { registry, requestType: Order, responseType: OrderResult })
class HttpOrderHandler implements IMessageHandler<Order, OrderResult> {
  async handleAsync(request: Order): Promise<IBenzeneResultOf<OrderResult>> {
    // A small await, so the two transports genuinely overlap in flight rather than running to completion serially.
    await new Promise((resolve) => setTimeout(resolve, 5));
    httpHandled.push(request.orderId ?? '<none>');
    const payload = new OrderResult();
    payload.reference = `http-${request.orderId}`;
    return BenzeneResult.ok(payload);
  }
}

@message('order:queue', { registry, requestType: Order, responseType: OrderResult })
class QueueOrderHandler implements IMessageHandler<Order, OrderResult> {
  async handleAsync(request: Order): Promise<IBenzeneResultOf<OrderResult>> {
    await new Promise((resolve) => setTimeout(resolve, 5));
    queueHandled.push(request.orderId ?? '<none>');
    return BenzeneResult.ok(new OrderResult());
  }
}

const context = {} as Context;
const callback = () => undefined;

// One process, two independent entry points — each its own StartUp/container/transport.
const httpApi = toLambdaHandler(
  new InlineAwsLambdaStartUp()
    .configureServices((services) => addBenzene(services))
    .configure((app) => useApiGateway(app, (api) => useMessageHandlers(api, HttpOrderHandler)))
    .build(),
);
const queue = toLambdaHandler(
  new InlineAwsLambdaStartUp()
    .configureServices((services) => addBenzene(services))
    .configure((app) => useSqs(app, (sqs) => useMessageHandlers(sqs, QueueOrderHandler)))
    .build(),
);

describe('multiple transports in one Node process', () => {
  it('runs an API Gateway transport and an SQS transport concurrently, with no cross-talk', async () => {
    httpHandled.length = 0;
    queueHandled.length = 0;

    // Fire both transports at the same time.
    const [httpResponse, sqsResponse] = await Promise.all([
      httpApi(asApiGatewayRequest(httpBuilder('POST', '/orders', { orderId: 'H1' })), context, callback) as Promise<{
        statusCode: number;
        body: string;
      }>,
      queue(asSqs(messageBuilder('order:queue', { orderId: 'Q1' })), context, callback) as Promise<{
        batchItemFailures: unknown[];
      }>,
    ]);

    // Each transport routed to its own handler — no interference.
    expect(httpHandled).toEqual(['H1']);
    expect(queueHandled).toEqual(['Q1']);
    expect(httpResponse.statusCode).toBe(200);
    expect(JSON.parse(httpResponse.body)).toEqual({ reference: 'http-H1' });
    expect(sqsResponse.batchItemFailures).toEqual([]);
  });

  it('the two entry points are isolated: neither recognizes the other transport’s event', async () => {
    // An SQS event sent to the HTTP entry point matches no router there -> not recognized.
    await expect(
      httpApi(asSqs(messageBuilder('order:queue', { orderId: 'X' })), context, callback),
    ).rejects.toThrow(/not been recognized/);

    // ...and vice versa: an API Gateway event sent to the queue entry point.
    await expect(
      queue(asApiGatewayRequest(httpBuilder('POST', '/orders', { orderId: 'Y' })), context, callback),
    ).rejects.toThrow(/not been recognized/);
  });

  it('sustains many concurrent invocations across both transports without state bleed', async () => {
    httpHandled.length = 0;
    queueHandled.length = 0;

    const invocations: Promise<unknown>[] = [];
    for (let i = 0; i < 10; i++) {
      invocations.push(
        Promise.resolve(httpApi(asApiGatewayRequest(httpBuilder('POST', '/orders', { orderId: `h${i}` })), context, callback)),
      );
      invocations.push(
        Promise.resolve(queue(asSqs(messageBuilder('order:queue', { orderId: `q${i}` })), context, callback)),
      );
    }
    await Promise.all(invocations);

    expect(httpHandled.sort()).toEqual(Array.from({ length: 10 }, (_v, i) => `h${i}`).sort());
    expect(queueHandled.sort()).toEqual(Array.from({ length: 10 }, (_v, i) => `q${i}`).sort());
  });
});

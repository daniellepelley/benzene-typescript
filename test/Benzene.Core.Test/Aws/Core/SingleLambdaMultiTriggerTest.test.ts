/**
 * Answers "does one-transport-per-entry-point force more Lambda functions (and more cold starts)?" — no.
 * A single deployed Lambda function can have MULTIPLE triggers (SQS + API Gateway + EventBridge all
 * pointing at it); AWS sends each event shape to the same exported `handler`. You dispatch to the right
 * Benzene entry point by event shape — each entry point is its own container, so no DI collision — and it
 * all runs in ONE execution environment (ONE warm pool, ONE cold-start profile).
 *
 * This test builds that single `handler` over three separate transport entry points and shows it routes
 * every trigger's event correctly — the "one Lambda instance marshals different transports" model, with no
 * new library code. A `CompositeAwsLambdaEntryPoint` (not built here) would just encapsulate this dispatch
 * and reuse each transport's own `canHandle` instead of the hand-rolled shape checks below.
 */
import { describe, expect, it } from 'vitest';
import { Context, Handler } from 'aws-lambda';
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import { addBenzene, message, MessageHandlersRegistry, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { httpEndpoint } from '@benzenejs/http';
import { InlineAwsLambdaStartUp, toLambdaHandler } from '@benzenejs/aws-lambda-core';
import { useApiGateway } from '@benzenejs/aws-lambda-api-gateway';
import { useSqs } from '@benzenejs/aws-lambda-sqs';
import { useEventBridge } from '@benzenejs/aws-lambda-eventbridge';
import { httpBuilder, messageBuilder } from '@benzenejs/testing';
import { asApiGatewayRequest, asEventBridge, asSqs } from '@benzenejs/aws-lambda-testing';

const handled: string[] = [];
const registry = new MessageHandlersRegistry();

class Order {
  orderId?: string;
}
class OrderResult {
  reference?: string;
}

@httpEndpoint('POST', '/orders')
@message('order:http', { registry, requestType: Order, responseType: OrderResult })
class HttpHandler implements IMessageHandler<Order, OrderResult> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderResult>> {
    handled.push(`http:${request.orderId}`);
    const payload = new OrderResult();
    payload.reference = `ref-${request.orderId}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

@message('order:queue', { registry, requestType: Order, responseType: OrderResult })
class QueueHandler implements IMessageHandler<Order, OrderResult> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderResult>> {
    handled.push(`queue:${request.orderId}`);
    return Promise.resolve(BenzeneResult.ok(new OrderResult()));
  }
}

@message('order.event', { registry, requestType: Order, responseType: OrderResult })
class EventHandler implements IMessageHandler<Order, OrderResult> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderResult>> {
    handled.push(`event:${request.orderId}`);
    return Promise.resolve(BenzeneResult.ok(new OrderResult()));
  }
}

// Three separate entry points (three containers) — but ONE process, and below, ONE exported handler.
const httpEntry = toLambdaHandler(
  new InlineAwsLambdaStartUp()
    .configureServices((s) => addBenzene(s))
    .configure((app) => useApiGateway(app, (api) => useMessageHandlers(api, HttpHandler)))
    .build(),
);
const queueEntry = toLambdaHandler(
  new InlineAwsLambdaStartUp()
    .configureServices((s) => addBenzene(s))
    .configure((app) => useSqs(app, (sqs) => useMessageHandlers(sqs, QueueHandler)))
    .build(),
);
const eventEntry = toLambdaHandler(
  new InlineAwsLambdaStartUp()
    .configureServices((s) => addBenzene(s))
    .configure((app) => useEventBridge(app, (eb) => useMessageHandlers(eb, EventHandler)))
    .build(),
);

// The single `handler` a Lambda with three triggers points at. AWS sends each trigger's event shape here.
const handler: Handler = (event, context, callback) => {
  const e = event as Record<string, unknown>;
  if (e['httpMethod'] !== undefined || (e['requestContext'] as Record<string, unknown> | undefined)?.['http']) {
    return httpEntry(event, context, callback);
  }
  if (Array.isArray(e['Records']) && (e['Records'][0] as Record<string, unknown>)?.['eventSource'] === 'aws:sqs') {
    return queueEntry(event, context, callback);
  }
  if (e['detail-type'] !== undefined && e['source'] !== undefined) {
    return eventEntry(event, context, callback);
  }
  throw new Error('No trigger recognized this event');
};

const context = {} as Context;
const callback = () => undefined;

describe('one Lambda function, multiple triggers, one exported handler', () => {
  it('routes an API Gateway trigger through the shared handler', async () => {
    handled.length = 0;
    const response = (await handler(
      asApiGatewayRequest(httpBuilder('POST', '/orders', { orderId: '1' })),
      context,
      callback,
    )) as { statusCode: number };
    expect(handled).toEqual(['http:1']);
    expect(response.statusCode).toBe(200);
  });

  it('routes an SQS trigger through the same handler (same warm instance)', async () => {
    handled.length = 0;
    await handler(asSqs(messageBuilder('order:queue', { orderId: '2' })), context, callback);
    expect(handled).toEqual(['queue:2']);
  });

  it('routes an EventBridge trigger through the same handler', async () => {
    handled.length = 0;
    await handler(asEventBridge(messageBuilder('order.event', { orderId: '3' })), context, callback);
    expect(handled).toEqual(['event:3']);
  });

  it('handles all three trigger types in sequence on one instance (as a warm environment would)', async () => {
    handled.length = 0;
    await handler(asApiGatewayRequest(httpBuilder('POST', '/orders', { orderId: 'a' })), context, callback);
    await handler(asSqs(messageBuilder('order:queue', { orderId: 'b' })), context, callback);
    await handler(asEventBridge(messageBuilder('order.event', { orderId: 'c' })), context, callback);
    expect(handled).toEqual(['http:a', 'queue:b', 'event:c']);
  });
});

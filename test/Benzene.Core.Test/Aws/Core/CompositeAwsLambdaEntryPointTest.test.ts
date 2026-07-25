/**
 * The composite entry point: one exported `handler` that marshals a Lambda's several triggers to the right
 * per-transport pipeline. This is the ergonomic form of the hand-rolled dispatch in
 * `SingleLambdaMultiTriggerTest` — one shared StartUp, N routes, one warm pool — reusing each transport's
 * own `canHandle` (via the shared `AwsEventPredicates`) instead of bespoke shape checks.
 */
import { describe, expect, it } from 'vitest';
import { Context, Handler } from 'aws-lambda';
import { IBenzeneResultOf, serviceToken } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { addBenzene, message, MessageHandlersRegistry, useMessageHandlers } from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import {
  compositeAwsLambda,
  isApiGatewayEvent,
  isEventBridgeEvent,
  isSqsEvent,
  toLambdaHandler,
} from '@benzene/aws-lambda-core';
import { useApiGateway } from '@benzene/aws-lambda-api-gateway';
import { useSqs } from '@benzene/aws-lambda-sqs';
import { useEventBridge } from '@benzene/aws-lambda-eventbridge';
import { httpBuilder, messageBuilder } from '@benzene/testing';
import { asApiGatewayRequest, asEventBridge, asSqs } from '@benzene/aws-lambda-testing';

// A shared service, registered once and threaded into every route's container as the SAME instance.
interface IAuditLog {
  readonly entries: string[];
}
class AuditLog implements IAuditLog {
  readonly entries: string[] = [];
}
const AuditLogToken = serviceToken<IAuditLog>('AuditLog');

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
  static readonly inject = [AuditLogToken] as const;
  constructor(private readonly audit: IAuditLog) {}
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderResult>> {
    this.audit.entries.push(`http:${request.orderId}`);
    const payload = new OrderResult();
    payload.reference = `ref-${request.orderId}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

@message('order:queue', { registry, requestType: Order, responseType: OrderResult })
class QueueHandler implements IMessageHandler<Order, OrderResult> {
  static readonly inject = [AuditLogToken] as const;
  constructor(private readonly audit: IAuditLog) {}
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderResult>> {
    this.audit.entries.push(`queue:${request.orderId}`);
    return Promise.resolve(BenzeneResult.ok(new OrderResult()));
  }
}

@message('order.event', { registry, requestType: Order, responseType: OrderResult })
class EventHandler implements IMessageHandler<Order, OrderResult> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderResult>> {
    return Promise.resolve(BenzeneResult.ok(new OrderResult()));
  }
}

const context = {} as Context;
const callback = () => undefined;

function build(audit: AuditLog): Handler {
  // One shared StartUp; three routes; each route gets addBenzene + the SAME AuditLog instance.
  const entryPoint = compositeAwsLambda((c) => {
    c.configureServices((s) => {
      addBenzene(s);
      s.addSingletonInstance(AuditLogToken, audit);
    });
    c.route(isApiGatewayEvent, (app) => useApiGateway(app, (api) => useMessageHandlers(api, HttpHandler)));
    c.route(isSqsEvent, (app) => useSqs(app, (sqs) => useMessageHandlers(sqs, QueueHandler)));
    c.route(isEventBridgeEvent, (app) => useEventBridge(app, (eb) => useMessageHandlers(eb, EventHandler)));
  });
  return toLambdaHandler(entryPoint);
}

describe('CompositeAwsLambdaEntryPoint', () => {
  it('dispatches each trigger shape to its own transport through one handler', async () => {
    const audit = new AuditLog();
    const handler = build(audit);

    const httpResponse = (await handler(
      asApiGatewayRequest(httpBuilder('POST', '/orders', { orderId: '1' })),
      context,
      callback,
    )) as { statusCode: number; body: string };
    const sqsResponse = (await handler(
      asSqs(messageBuilder('order:queue', { orderId: '2' })),
      context,
      callback,
    )) as { batchItemFailures: unknown[] };
    await handler(asEventBridge(messageBuilder('order.event', { orderId: '3' })), context, callback);

    expect(httpResponse.statusCode).toBe(200);
    expect(JSON.parse(httpResponse.body)).toEqual({ reference: 'ref-1' });
    expect(sqsResponse.batchItemFailures).toEqual([]);
  });

  it('shares a registered instance across every route (one startup, one shared singleton)', async () => {
    const audit = new AuditLog();
    const handler = build(audit);

    await handler(asApiGatewayRequest(httpBuilder('POST', '/orders', { orderId: 'H' })), context, callback);
    await handler(asSqs(messageBuilder('order:queue', { orderId: 'Q' })), context, callback);

    // Both the HTTP route and the SQS route wrote to the SAME AuditLog object.
    expect(audit.entries).toEqual(['http:H', 'queue:Q']);
  });

  it('surfaces a function error when no route recognizes the event', async () => {
    const handler = build(new AuditLog());
    await expect(handler({ nothing: 'here' }, context, callback)).rejects.toThrow(/not been recognized/);
  });

  it('is itself an IAwsLambdaEntryPoint (disposable, wrappable by toLambdaHandler)', () => {
    const entryPoint = compositeAwsLambda((c) => {
      c.configureServices((s) => addBenzene(s));
      c.route(isSqsEvent, (app) => useSqs(app, (sqs) => useMessageHandlers(sqs, QueueHandler)));
    });
    expect(() => entryPoint.dispose()).not.toThrow();
  });
});

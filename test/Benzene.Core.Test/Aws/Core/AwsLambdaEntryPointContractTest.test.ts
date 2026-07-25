/**
 * Proves the AWS Lambda entry point conforms to the AWS Node.js runtime contract — the concern being that,
 * unlike .NET (whose Lambda handler is `Stream FunctionHandlerAsync(Stream, ILambdaContext)` and sniffs the
 * raw payload), a Node Lambda handler receives the ALREADY-PARSED event and returns a Promise of the result
 * payload (per `@types/aws-lambda`'s `Handler`: "event = Parsed JSON data in the lambda request payload …
 * return a promise that resolves with the result payload").
 *
 * So this test invokes the exported handler exactly as AWS invokes it — `handler(event, context, callback)`,
 * a real parsed event object in, a Promise of the AWS-shaped result out — for each event source, and checks
 * the entry point deserializes the event, routes it through the Benzene middleware, and returns what AWS
 * expects for that integration. (Each transport is wired in its own entry point, the port's
 * one-transport-per-entry-point pattern — see the note on `ApiGatewayV2LambdaHandler`.)
 */
import { describe, expect, it } from 'vitest';
import { Callback, Context, Handler } from 'aws-lambda';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { addBenzene, message, MessageHandlersRegistry, useMessageHandlers } from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { InlineAwsLambdaStartUp, toLambdaHandler } from '@benzene/aws-lambda-core';
import { useApiGateway, useApiGatewayV2 } from '@benzene/aws-lambda-api-gateway';
import { useSqs } from '@benzene/aws-lambda-sqs';
import { httpBuilder, messageBuilder } from '@benzene/testing';
import { asApiGatewayRequest, asApiGatewayV2Request, asSqs } from '@benzene/aws-lambda-testing';

class Order {
  orderId?: string;
}
class OrderCreated {
  reference?: string;
}

const handled: string[] = [];
const registry = new MessageHandlersRegistry();

@httpEndpoint('POST', '/orders')
@message('order:create', { registry, requestType: Order, responseType: OrderCreated })
class CreateOrderHandler implements IMessageHandler<Order, OrderCreated> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderCreated>> {
    handled.push(request.orderId ?? '<none>');
    const payload = new OrderCreated();
    payload.reference = `ref-${request.orderId}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

const context = {} as Context;
// AWS always passes a completion callback as the third argument; an async handler ignores it and returns a
// Promise instead. Passing it here exercises the full Handler(event, context, callback) signature.
const callback: Callback = () => undefined;

/** Invokes the handler through the AWS `Handler` type — the exact call shape the Node runtime uses. */
async function invokeAsAws(handler: Handler, event: unknown): Promise<unknown> {
  return (await handler(event, context, callback)) as unknown;
}

function apiGatewayEntry(useV2: boolean): Handler {
  return toLambdaHandler(
    new InlineAwsLambdaStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((app) =>
        useV2
          ? useApiGatewayV2(app, (api) => useMessageHandlers(api, CreateOrderHandler))
          : useApiGateway(app, (api) => useMessageHandlers(api, CreateOrderHandler)),
      )
      .build(),
  );
}

describe('AWS Lambda entry point — Node.js runtime contract', () => {
  it('accepts a parsed API Gateway v1 event and returns the {statusCode, body} AWS proxy expects', async () => {
    handled.length = 0;
    const response = (await invokeAsAws(
      apiGatewayEntry(false),
      asApiGatewayRequest(httpBuilder('POST', '/orders', { orderId: '42' })),
    )) as { statusCode: number; body: string };

    expect(handled).toEqual(['42']);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ reference: 'ref-42' });
  });

  it('accepts a parsed API Gateway v2 (HTTP API) event and returns a structured v2 result', async () => {
    handled.length = 0;
    const response = (await invokeAsAws(
      apiGatewayEntry(true),
      asApiGatewayV2Request(httpBuilder('POST', '/orders', { orderId: '43' })),
    )) as { statusCode: number; body: string };

    expect(handled).toEqual(['43']);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ reference: 'ref-43' });
  });

  it('accepts a parsed SQS event and returns the {batchItemFailures} partial-batch shape', async () => {
    handled.length = 0;
    const handler = toLambdaHandler(
      new InlineAwsLambdaStartUp()
        .configureServices((services) => addBenzene(services))
        .configure((app) => useSqs(app, (sqs) => useMessageHandlers(sqs, CreateOrderHandler)))
        .build(),
    );

    const response = (await invokeAsAws(
      handler,
      asSqs(messageBuilder('order:create', { orderId: '7' }), { numberOfMessages: 2 }),
    )) as { batchItemFailures: unknown[] };

    expect(handled).toEqual(['7', '7']);
    expect(response.batchItemFailures).toEqual([]); // both records succeeded
  });

  it('rejects (surfaces a Lambda function error) when the parsed event matches no registered transport', async () => {
    const handler = apiGatewayEntry(false);

    // A bare custom payload with no event-source discriminant — the entry point recognizes nothing.
    await expect(invokeAsAws(handler, { hello: 'world' })).rejects.toThrow(/not been recognized/);
  });
});

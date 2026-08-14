/**
 * Drives every function in `@benzene-example/aws-lambda-functions` end-to-end: build the transport's
 * native event with `@benzenejs/aws-lambda-testing`, invoke the exported `handler` exactly as AWS would,
 * and assert the shared handler ran. This proves the example's "one domain, five transports" claim -
 * the API Gateway function returns a confirmation, and each async transport delivers to the same
 * warehouse consumer.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from 'aws-lambda';
import { httpBuilder, messageBuilder } from '@benzenejs/testing';
import {
  asApiGatewayRequest,
  asAwsKafkaEvent,
  asEventBridge,
  asSns,
  asSqs,
} from '@benzenejs/aws-lambda-testing';
import {
  apiGatewayFunction,
  eventBridgeFunction,
  kafkaFunction,
  snsFunction,
  sqsFunction,
  warehouseNotifications,
} from '@benzene-example/aws-lambda-functions';

const context = {} as Context;
const noopCallback = () => undefined;

beforeEach(() => {
  warehouseNotifications.length = 0;
});

describe('@benzene-example/aws-lambda-functions', () => {
  it('API Gateway: POST /orders returns a 201 confirmation', async () => {
    const event = asApiGatewayRequest(httpBuilder('POST', '/orders', { customerId: 'acme' }));

    const response = (await apiGatewayFunction.handler(event, context, noopCallback)) as {
      statusCode: number;
      body: string;
    };

    expect(response.statusCode).toBe(201); // BenzeneResult.created -> 201
    expect(JSON.parse(response.body)).toEqual({ orderId: 'order-acme' });
  });

  it('SQS: each record routes to the warehouse consumer', async () => {
    const event = asSqs(messageBuilder('order:placed', { orderId: 'order-1' }), { numberOfMessages: 2 });

    await sqsFunction.handler(event, context, noopCallback);

    expect(warehouseNotifications).toEqual(['order-1', 'order-1']);
  });

  it('SNS: the notification routes to the warehouse consumer', async () => {
    await snsFunction.handler(asSns(messageBuilder('order:placed', { orderId: 'order-2' })), context, noopCallback);
    expect(warehouseNotifications).toEqual(['order-2']);
  });

  it('EventBridge: the detail-type routes to the warehouse consumer', async () => {
    await eventBridgeFunction.handler(
      asEventBridge(messageBuilder('order:placed', { orderId: 'order-3' })),
      context,
      noopCallback,
    );
    expect(warehouseNotifications).toEqual(['order-3']);
  });

  it('Kafka: the record topic routes to the warehouse consumer', async () => {
    await kafkaFunction.handler(
      asAwsKafkaEvent(messageBuilder('order:placed', { orderId: 'order-4' })),
      context,
      noopCallback,
    );
    expect(warehouseNotifications).toEqual(['order-4']);
  });
});

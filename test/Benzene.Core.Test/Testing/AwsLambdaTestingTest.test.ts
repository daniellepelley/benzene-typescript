/**
 * The test harness in action: each AWS Lambda transport builder (`@benzene/aws-lambda-testing`) turns a
 * single platform-neutral `messageBuilder`/`httpBuilder` into that transport's native event, which is
 * then driven through the *real* Benzene pipeline for that transport (via `InlineAwsLambdaStartUp`). A
 * green assertion proves the generated event actually routes and deserializes - i.e. the builder is a
 * faithful stand-in for a real cloud event, which is what makes it usable for transport unit tests.
 *
 * This is the DX win the package exists for: one ergonomic builder replaces the bespoke, per-transport
 * event factories every pipeline test would otherwise hand-roll.
 */
import { describe, expect, it } from 'vitest';
import { Context } from 'aws-lambda';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { BenzeneResult } from '@benzene/results';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
  usePresetTopic,
} from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { InlineAwsLambdaStartUp } from '@benzene/aws-lambda-core';
import { useApiGateway } from '@benzene/aws-lambda-api-gateway';
import { useSqs } from '@benzene/aws-lambda-sqs';
import { useSns } from '@benzene/aws-lambda-sns';
import { useEventBridge } from '@benzene/aws-lambda-eventbridge';
import { useKafka } from '@benzene/aws-lambda-kafka';
import { useDynamoDb } from '@benzene/aws-lambda-dynamodb';
import { useKinesis } from '@benzene/aws-lambda-kinesis';
import { useS3 } from '@benzene/aws-lambda-s3';
import { httpBuilder, messageBuilder } from '@benzene/testing';
import {
  asApiGatewayRequest,
  asAwsKafkaEvent,
  asDynamoDb,
  asEventBridge,
  asKinesis,
  asS3,
  asSns,
  asSqs,
} from '@benzene/aws-lambda-testing';

class Order {
  orderId: string | undefined;
}

class OrderResult {
  reference: string | undefined;
}

const handled: string[] = [];
const registry = new MessageHandlersRegistry();

@httpEndpoint('POST', '/orders')
@message('create-order', { registry, requestType: Order, responseType: OrderResult })
class CreateOrderHandler implements IMessageHandler<Order, OrderResult> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderResult>> {
    handled.push(request.orderId ?? '<none>');
    const payload = new OrderResult();
    payload.reference = `ref-${request.orderId}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

// Kafka routes on the record's Kafka topic; EventBridge on detail-type. Give each its own handler topic.
@message('orders', { registry, requestType: Order, responseType: OrderResult })
class KafkaOrderHandler implements IMessageHandler<Order, OrderResult> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderResult>> {
    handled.push(request.orderId ?? '<none>');
    return Promise.resolve(BenzeneResult.ok(new OrderResult()));
  }
}

@message('order.created', { registry, requestType: Order, responseType: OrderResult })
class EventBridgeOrderHandler implements IMessageHandler<Order, OrderResult> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderResult>> {
    handled.push(request.orderId ?? '<none>');
    return Promise.resolve(BenzeneResult.ok(new OrderResult()));
  }
}

// DynamoDB routes on `{table}:{eventName}`; the AttributeValue image unmarshals to the request.
@message('orders:INSERT', { registry, requestType: Order, responseType: OrderResult })
class DynamoOrderHandler implements IMessageHandler<Order, OrderResult> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderResult>> {
    handled.push(request.orderId ?? '<none>');
    return Promise.resolve(BenzeneResult.ok(new OrderResult()));
  }
}

// S3 has no JSON body: the request is the object reference (bucket + key), routed by the S3 event name.
class FileUploaded {
  bucketName?: string;
  key?: string;
}

@message('ObjectCreated:Put', { registry, requestType: FileUploaded, responseType: OrderResult })
class S3FileHandler implements IMessageHandler<FileUploaded, OrderResult> {
  handleAsync(request: FileUploaded): Promise<IBenzeneResultOf<OrderResult>> {
    handled.push(`${request.bucketName}/${request.key}`);
    return Promise.resolve(BenzeneResult.ok(new OrderResult()));
  }
}

const fakeLambdaContext = {} as Context;

describe('AWS Lambda test-event builders drive the real pipeline', () => {
  it('asApiGatewayRequest routes an HTTP request to the handler and returns 200', async () => {
    handled.length = 0;
    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((app) => useApiGateway(app, (api) => useMessageHandlers(api, CreateOrderHandler)))
      .build();

    const event = asApiGatewayRequest(httpBuilder('POST', '/orders', { orderId: '42' }));
    const response = (await entryPoint.functionHandlerAsync(event, fakeLambdaContext)) as {
      statusCode: number;
      body: string;
    };

    expect(handled).toEqual(['42']);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ reference: 'ref-42' });
  });

  it('asSqs routes each record (topic message attribute) to the handler', async () => {
    handled.length = 0;
    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((app) => useSqs(app, (sqs) => useMessageHandlers(sqs, CreateOrderHandler)))
      .build();

    const event = asSqs(messageBuilder('create-order', { orderId: '42' }), { numberOfMessages: 2 });
    const response = (await entryPoint.functionHandlerAsync(event, fakeLambdaContext)) as {
      batchItemFailures: unknown[];
    };

    expect(handled).toEqual(['42', '42']);
    expect(response.batchItemFailures).toEqual([]);
  });

  it('asSns routes the notification (topic message attribute) to the handler', async () => {
    handled.length = 0;
    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((app) => useSns(app, (sns) => useMessageHandlers(sns, CreateOrderHandler)))
      .build();

    await entryPoint.functionHandlerAsync(
      asSns(messageBuilder('create-order', { orderId: '42' })),
      fakeLambdaContext,
    );

    expect(handled).toEqual(['42']);
  });

  it('asEventBridge routes on detail-type to the handler', async () => {
    handled.length = 0;
    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((app) => useEventBridge(app, (eb) => useMessageHandlers(eb, EventBridgeOrderHandler)))
      .build();

    await entryPoint.functionHandlerAsync(
      asEventBridge(messageBuilder('order.created', { orderId: 'ABC' })),
      fakeLambdaContext,
    );

    expect(handled).toEqual(['ABC']);
  });

  it('asAwsKafkaEvent routes on the record topic to the handler', async () => {
    handled.length = 0;
    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((app) => useKafka(app, (kafka) => useMessageHandlers(kafka, KafkaOrderHandler)))
      .build();

    await entryPoint.functionHandlerAsync(
      asAwsKafkaEvent(messageBuilder('orders', { orderId: '42' })),
      fakeLambdaContext,
    );

    expect(handled).toEqual(['42']);
  });

  it('asDynamoDb marshals the image and routes on {table}:{eventName}', async () => {
    handled.length = 0;
    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((app) => useDynamoDb(app, (dynamo) => useMessageHandlers(dynamo, DynamoOrderHandler)))
      .build();

    const response = (await entryPoint.functionHandlerAsync(
      asDynamoDb(messageBuilder('orders:INSERT', { orderId: '42' })),
      fakeLambdaContext,
    )) as { batchItemFailures: unknown[] };

    // The AttributeValue image ({ orderId: { S: '42' } }) unmarshalled back to { orderId: '42' }.
    expect(handled).toEqual(['42']);
    expect(response.batchItemFailures).toEqual([]);
  });

  it('asKinesis base64-encodes the record and routes via the preset topic', async () => {
    handled.length = 0;
    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((app) =>
        useKinesis(app, (kinesis) => {
          usePresetTopic(kinesis, 'create-order');
          useMessageHandlers(kinesis, CreateOrderHandler);
        }),
      )
      .build();

    // Kinesis carries no topic, so the builder's topic is a placeholder; routing is the preset.
    await entryPoint.functionHandlerAsync(
      asKinesis(messageBuilder('n/a', { orderId: '42' })),
      fakeLambdaContext,
    );

    expect(handled).toEqual(['42']);
  });

  it('asS3 routes the object notification by event name to the handler', async () => {
    handled.length = 0;
    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((app) => useS3(app, (s3) => useMessageHandlers(s3, S3FileHandler)))
      .build();

    await entryPoint.functionHandlerAsync(
      asS3('my-bucket', 'photos/cat.png', { eventName: 'ObjectCreated:Put' }),
      fakeLambdaContext,
    );

    expect(handled).toEqual(['my-bucket/photos/cat.png']);
  });
});

describe('AWS Lambda builder event shape + options', () => {
  it('asSqs carries the topic attribute and honors numberOfMessages + a custom serializer', () => {
    const event = asSqs(messageBuilder('order:create', { orderId: '42' }).withHeader('tenant', 'acme'), {
      numberOfMessages: 3,
      serializer: { serialize: () => 'CUSTOM' },
    });

    expect(event.Records).toHaveLength(3);
    const record = event.Records[0]!;
    expect(record.body).toBe('CUSTOM');
    expect(record.messageAttributes['topic']?.stringValue).toBe('order:create');
    expect(record.messageAttributes['tenant']?.stringValue).toBe('acme');
    expect(record.eventSource).toBe('aws:sqs');
  });
});

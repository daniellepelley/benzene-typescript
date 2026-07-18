import { describe, expect, it } from 'vitest';
import { Context, KinesisStreamEvent, KinesisStreamRecord } from 'aws-lambda';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { BenzeneResult } from '@benzene/results';
import { BenzeneException } from '@benzene/core';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
  usePresetTopic,
} from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { InlineAwsLambdaStartUp } from '@benzene/aws-lambda-core';
import {
  addKinesis,
  KinesisApplication,
  KinesisMessageContext,
  useKinesis,
} from '@benzene/aws-lambda-kinesis';

/**
 * End-to-end port of the C# Kinesis tests, adapted to this port's PER-RECORD FAN-OUT model (the C#
 * streaming engine is not yet ported — see `KinesisMessageContext`). A Kinesis record carries no topic,
 * so the pipeline routes records to a fixed topic via `usePresetTopic`. The body is base64-decoded from
 * `record.kinesis.data`. Kinesis is fire-and-forget, so the router writes the `null` "handled" sentinel.
 */

class Order {
  orderId: string | undefined;
}

class OrderCreated {
  reference: string | undefined;
}

const handled: string[] = [];
const registry = new MessageHandlersRegistry();

@message('create-order', { registry, requestType: Order, responseType: OrderCreated })
class CreateOrderHandler implements IMessageHandler<Order, OrderCreated> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderCreated>> {
    handled.push(request.orderId ?? '<none>');
    const payload = new OrderCreated();
    payload.reference = `ref-${request.orderId}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

function createKinesisRecord(sequenceNumber: string, body: unknown): KinesisStreamRecord {
  return {
    awsRegion: 'us-east-1',
    eventID: `shardId-000000000000:${sequenceNumber}`,
    eventName: 'aws:kinesis:record',
    eventSource: 'aws:kinesis',
    eventSourceARN: 'arn:aws:kinesis:us-east-1:123456789012:stream/orders',
    eventVersion: '1.0',
    invokeIdentityArn: 'arn:aws:iam::123456789012:role/lambda',
    kinesis: {
      approximateArrivalTimestamp: 0,
      data: Buffer.from(JSON.stringify(body)).toString('base64'),
      kinesisSchemaVersion: '1.0',
      partitionKey: 'partition-1',
      sequenceNumber,
    },
  };
}

function createKinesisEvent(
  records: { sequenceNumber: string; body: unknown }[],
): KinesisStreamEvent {
  return { Records: records.map((r) => createKinesisRecord(r.sequenceNumber, r.body)) };
}

const fakeLambdaContext = {} as Context;

describe('KinesisPipeline (via AwsLambdaEntryPoint)', () => {
  it('routes a base64 Kinesis record to a preset-topic handler (fire-and-forget)', async () => {
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

    const event = createKinesisEvent([{ sequenceNumber: '1', body: { orderId: '42' } }]);

    const response = await entryPoint.functionHandlerAsync(event, fakeLambdaContext);

    // The handler ran with the base64-decoded body...
    expect(handled).toEqual(['42']);
    // ...and Kinesis is fire-and-forget: the router marks the event handled with the null sentinel.
    expect(response).toBeNull();
  });

  it('throws BenzeneException when no router recognizes the event', async () => {
    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((app) =>
        useKinesis(app, (kinesis) => {
          usePresetTopic(kinesis, 'create-order');
          useMessageHandlers(kinesis, CreateOrderHandler);
        }),
      )
      .build();

    await expect(entryPoint.functionHandlerAsync({ foo: 'bar' }, fakeLambdaContext)).rejects.toThrow(
      BenzeneException,
    );
  });
});

describe('KinesisApplication (direct)', () => {
  it('runs every record through the pipeline in its own scope, base64-decoding the data', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addKinesis(container);

    const seenBodies: string[] = [];
    const pipeline = new MiddlewarePipelineBuilder<KinesisMessageContext>(container);
    pipeline.useFn(async (context, next) => {
      seenBodies.push(Buffer.from(context.record.kinesis.data, 'base64').toString('utf8'));
      await next();
    });

    const application = new KinesisApplication(pipeline.build());
    const event = createKinesisEvent([
      { sequenceNumber: '1', body: { orderId: '1' } },
      { sequenceNumber: '2', body: { orderId: '2' } },
    ]);

    await application.handleAsync(event, container.createServiceResolverFactory());

    expect(seenBodies.sort()).toEqual(
      [JSON.stringify({ orderId: '1' }), JSON.stringify({ orderId: '2' })].sort(),
    );
  });
});

import { describe, expect, it } from 'vitest';
import { KinesisStreamEvent, KinesisStreamRecord } from 'aws-lambda';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { BenzeneResult } from '@benzenejs/results';
import { BenzeneException } from '@benzenejs/core';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
  usePresetTopic,
} from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import {
  addKinesis,
  KinesisApplication,
  KinesisMessageContext,
  useKinesis,
} from '@benzenejs/aws-lambda-kinesis';
import { useAwsLambda } from '@benzenejs/aws-lambda-core';
import { benzeneTestHost, messageBuilder, type BenzeneStartUp } from '@benzenejs/testing';
import { asKinesis } from '@benzenejs/aws-lambda-testing';

/**
 * End-to-end port of the C# Kinesis tests, adapted to this port's PER-RECORD model (the C# streaming
 * engine is not yet ported — see `KinesisMessageContext`). A Kinesis record carries no topic, so the
 * pipeline routes records to a fixed topic via `usePresetTopic`. The body is base64-decoded from
 * `record.kinesis.data`. Since W3.3 the router writes back a real `KinesisStreamBatchResponse`
 * (checkpoint engine — see KinesisStreamCheckpointTest for the resume-point semantics).
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

// Migrated off `InlineAwsLambdaStartUp` to the public startup-host harness
// (`benzeneTestHost(StartUp).buildAwsLambdaHost()` + `host.sendEventAsync(...)`) with the `asKinesis`
// event builder — the exact shape an adopter copies. A Kinesis record carries no topic, so the pipeline
// routes via `usePresetTopic` and the builder's topic is a placeholder.
class KinesisStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder): void {
    useAwsLambda(app, (aws) =>
      useKinesis(aws, (kinesis) => {
        usePresetTopic(kinesis, 'create-order');
        useMessageHandlers(kinesis, CreateOrderHandler);
      }),
    );
  }
}

describe('KinesisPipeline (via the benzeneTestHost harness)', () => {
  it('routes a base64 Kinesis record to a preset-topic handler (fire-and-forget)', async () => {
    handled.length = 0;

    const host = benzeneTestHost(KinesisStartUp).buildAwsLambdaHost();

    const response = await host.sendEventAsync(
      asKinesis(messageBuilder('create-order', { orderId: '42' })),
    );

    // The handler ran with the base64-decoded body...
    expect(handled).toEqual(['42']);
    // ...and the router writes back the checkpoint engine's batch response — a fully-processed batch
    // reports no failures (its resume point advanced to the end).
    expect(response).toEqual({ batchItemFailures: [] });
  });

  it('throws BenzeneException when no router recognizes the event', async () => {
    const host = benzeneTestHost(KinesisStartUp).buildAwsLambdaHost();

    await expect(host.sendEventAsync({ foo: 'bar' })).rejects.toThrow(BenzeneException);
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
      context.isSuccessful = true;
      await next();
    });

    const application = new KinesisApplication(pipeline.build());
    const event = createKinesisEvent([
      { sequenceNumber: '1', body: { orderId: '1' } },
      { sequenceNumber: '2', body: { orderId: '2' } },
    ]);

    const response = await application.handleAsync(event, container.createServiceResolverFactory());

    // Same partition key -> sequential in shard order (the checkpoint engine's ordering guarantee).
    expect(seenBodies).toEqual([JSON.stringify({ orderId: '1' }), JSON.stringify({ orderId: '2' })]);
    expect(response).toEqual({ batchItemFailures: [] });
  });
});

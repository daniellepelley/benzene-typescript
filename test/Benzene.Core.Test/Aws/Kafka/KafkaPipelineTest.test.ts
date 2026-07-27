import { describe, expect, it } from 'vitest';
import { MSKEvent, MSKRecord } from 'aws-lambda';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzene/abstractions';
import { IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { IMessageHandler, IMessageResult } from '@benzene/abstractions-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { BenzeneResult } from '@benzene/results';
import { BenzeneException } from '@benzene/core';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import {
  addKafka,
  KafkaApplication,
  KafkaContext,
  useKafka,
} from '@benzene/aws-lambda-kafka';
import { useAwsLambda } from '@benzene/aws-lambda-core';
import { benzeneTestHost, messageBuilder, type BenzeneStartUp } from '@benzene/testing';
import { asAwsKafkaEvent } from '@benzene/aws-lambda-testing';

/**
 * End-to-end port of the C# Kafka pipeline test
 * (test/Benzene.Core.Test/Aws/Kafka/KafkaMessagePipelineTest.cs): wire the full stack via idiomatic DI and
 * feed a realistic MSKEvent through the Lambda entry point / Kafka router / message-handler pipeline. The
 * topic is the record's native Kafka topic and the body is the BASE64-decoded `value`. Kafka's `records` is
 * an OBJECT keyed by `"topic-partition"`; the application flattens it. Kafka is fire-and-forget, so the
 * router writes the `null` "handled" sentinel.
 */

class Order {
  orderId: string | undefined;
}

class OrderCreated {
  reference: string | undefined;
}

const handled: string[] = [];
const registry = new MessageHandlersRegistry();

@message('orders', { registry, requestType: Order, responseType: OrderCreated })
class OrderHandler implements IMessageHandler<Order, OrderCreated> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderCreated>> {
    handled.push(request.orderId ?? '<none>');
    const payload = new OrderCreated();
    payload.reference = `ref-${request.orderId}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

function createKafkaRecord(topic: string, partition: number, body: unknown): MSKRecord {
  return {
    topic,
    partition,
    offset: 0,
    timestamp: 0,
    timestampType: 'CREATE_TIME',
    key: Buffer.from('key').toString('base64'),
    value: Buffer.from(JSON.stringify(body), 'utf8').toString('base64'),
    headers: [],
  };
}

function createKafkaEvent(
  records: { topic: string; partition: number; body: unknown }[],
): MSKEvent {
  const grouped: { [topicPartition: string]: MSKRecord[] } = {};
  for (const r of records) {
    const key = `${r.topic}-${r.partition}`;
    (grouped[key] ??= []).push(createKafkaRecord(r.topic, r.partition, r.body));
  }
  return {
    eventSource: 'aws:kafka',
    eventSourceArn: 'arn:aws:kafka:us-east-1:123456789012:cluster/demo/uuid',
    bootstrapServers: 'b-1.demo.kafka.us-east-1.amazonaws.com:9092',
    records: grouped,
  };
}

// Migrated off `InlineAwsLambdaStartUp` to the public startup-host harness
// (`benzeneTestHost(StartUp).buildAwsLambdaHost()` + `host.sendEventAsync(...)`) with the `asAwsKafkaEvent`
// event builder — the exact shape an adopter copies.
class KafkaStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder): void {
    useAwsLambda(app, (aws) => useKafka(aws, (kafka) => useMessageHandlers(kafka, OrderHandler)));
  }
}

describe('KafkaPipeline (via the benzeneTestHost harness)', () => {
  it('routes a Kafka record to a decorated handler by topic (fire-and-forget)', async () => {
    handled.length = 0;

    const host = benzeneTestHost(KafkaStartUp).buildAwsLambdaHost();

    const response = await host.sendEventAsync(
      asAwsKafkaEvent(messageBuilder('orders', { orderId: '42' })),
    );

    // The handler genuinely ran with the base64-decoded value deserialized into its request...
    expect(handled).toEqual(['42']);
    // ...and Kafka is fire-and-forget: the router marks the event handled with the null sentinel.
    expect(response).toBeNull();
  });

  it('throws BenzeneException when no router recognizes the event', async () => {
    const host = benzeneTestHost(KafkaStartUp).buildAwsLambdaHost();

    await expect(host.sendEventAsync({ foo: 'bar' })).rejects.toThrow(BenzeneException);
  });
});

describe('KafkaApplication (direct)', () => {
  it('flattens the keyed records object and runs each through the pipeline, recording the result', async () => {
    handled.length = 0;

    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addKafka(container);

    let messageResult: IMessageResult | undefined;
    const seenTopics: string[] = [];
    const pipeline = new MiddlewarePipelineBuilder<KafkaContext>(container);
    pipeline
      .useFn(async (context, next) => {
        seenTopics.push(context.kafkaEventRecord.topic);
        await next();
      })
      .onResponse((context) => {
        messageResult = context.messageResult;
      });
    useMessageHandlers(pipeline, OrderHandler);

    const application = new KafkaApplication(pipeline.build());
    const event = createKafkaEvent([{ topic: 'orders', partition: 0, body: { orderId: '7' } }]);

    await application.handleAsync(event, container.createServiceResolverFactory());

    expect(seenTopics).toEqual(['orders']);
    expect(handled).toEqual(['7']);
    expect(messageResult?.isSuccessful).toBe(true);
  });
});

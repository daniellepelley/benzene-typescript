import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { IMessageGetter, IMessageHandler, IMessageResult } from '@benzenejs/abstractions-message-handlers';
import type { MSKEvent, MSKRecord } from 'aws-lambda';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { BenzeneResult } from '@benzenejs/results';
import { BenzeneException } from '@benzenejs/core';
import {
  addBenzene,
  addContextItems,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import {
  addKafka,
  KafkaApplication,
  KafkaContext,
  KafkaMessageHeadersGetter,
  KafkaMessageTopicGetter,
  useKafka,
} from '@benzenejs/aws-lambda-kafka';
import { useAwsLambda } from '@benzenejs/aws-lambda-core';
import { benzeneTestHost, messageBuilder, type BenzeneStartUp } from '@benzenejs/testing';
import { asAwsKafkaEvent } from '@benzenejs/aws-lambda-testing';

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
    // ...and the partial-batch response reports no failed partition.
    expect(response).toEqual({ batchItemFailures: [] });
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
    const event = asAwsKafkaEvent(messageBuilder('orders', { orderId: '7' }));

    await application.handleAsync(event, container.createServiceResolverFactory());

    expect(seenTopics).toEqual(['orders']);
    expect(handled).toEqual(['7']);
    expect(messageResult?.isSuccessful).toBe(true);
  });
});

// transport-bindings.md, Kafka (spec ruling Benzene 0b53dddb): a record routes on its `topic` header,
// falling back to the Kafka topic it was consumed from.
describe('MSK getters', () => {
  function mskContext(topic: string, headers: Record<string, string>[]): KafkaContext {
    const encode = (value: string): number[] => Array.from(Buffer.from(value, 'utf8'));
    const record = {
      topic,
      partition: 0,
      offset: 1,
      value: '',
      headers: headers.map((entry) => Object.fromEntries(Object.entries(entry).map(([k, v]) => [k, encode(v)]))),
    } as unknown as MSKRecord;
    return new KafkaContext({ eventSource: 'aws:kafka', records: {} } as unknown as MSKEvent, record);
  }

  it('routes on the topic header when present', () => {
    expect(new KafkaMessageTopicGetter().getTopic(mskContext('orders', [{ topic: 'order:create' }]))?.id).toBe('order:create');
  });

  it('falls back to the Kafka topic when there is no topic header', () => {
    expect(new KafkaMessageTopicGetter().getTopic(mskContext('orders', [{ tenant: 'acme' }]))?.id).toBe('orders');
  });

  it('flattens every header entry, consumes the topic header and does not inject the Kafka topic', () => {
    const headers = new KafkaMessageHeadersGetter().getHeaders(
      mskContext('orders', [{ topic: 'order:create' }, { 'benzene-version': '2' }, { tenant: 'acme' }]),
    );
    expect(headers).toEqual({ 'benzene-version': '2', tenant: 'acme' });
  });

  it('selects the version from benzene-version through the DI wiring', () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addKafka(container);
    addContextItems(container);
    const getter = container.createServiceResolverFactory().createScope().getService(IMessageGetter) as unknown as IMessageGetter<KafkaContext>;
    const topic = getter.getTopic(mskContext('orders', [{ topic: 'order:create' }, { 'benzene-version': '2' }]));
    expect(topic?.id).toBe('order:create');
    expect(topic?.version).toBe('2');
  });
});

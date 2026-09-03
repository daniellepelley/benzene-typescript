import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { IMessageHandler, IMessageResult } from '@benzenejs/abstractions-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { BenzeneResult } from '@benzenejs/results';
import { BenzeneException } from '@benzenejs/core';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import {
  addKafka,
  KafkaApplication,
  KafkaBatchFailureMode,
  KafkaBatchProcessingException,
  KafkaContext,
  KafkaOptions,
  useKafka,
} from '@benzenejs/aws-lambda-kafka';
import { MSKEvent, MSKRecord } from 'aws-lambda';
import { useAwsLambda } from '@benzenejs/aws-lambda-core';
import { benzeneTestHost, messageBuilder, type BenzeneStartUp } from '@benzenejs/testing';
import { asAwsKafkaEvent } from '@benzenejs/aws-lambda-testing';

/**
 * End-to-end port of the C# Kafka pipeline test
 * (test/Benzene.Core.Test/Aws/Kafka/KafkaMessagePipelineTest.cs): wire the full stack via idiomatic DI and
 * feed a realistic MSKEvent through the Lambda entry point / Kafka router / message-handler pipeline. The
 * topic is the record's native Kafka topic and the body is the BASE64-decoded `value`. Kafka's `records` is
 * an OBJECT keyed by `"topic-partition"`; the application processes each partition sequentially in offset
 * order and reports failed partitions back in a `KafkaBatchResponse` (for `ReportBatchItemFailures`).
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
    // ...and the router writes the (empty) batch response so an event source mapping configured
    // with ReportBatchItemFailures sees no failed partitions.
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

// Ports the .NET KafkaApplication batch-failure behaviour (Benzene.Aws.Lambda.Kafka): partitions are
// processed sequentially in offset order, stop at the first failure, and report {partition, offset}
// resume points; the null-outcome carve-out (work/settlement-consistency-fix-plan.md row 14 in
// benzene-dotnet) is pinned positively.
describe('KafkaApplication (batch failure handling)', () => {
  function mskRecord(topic: string, partition: number, offset: number, body: unknown): MSKRecord {
    return {
      topic,
      partition,
      offset,
      timestamp: 0,
      timestampType: 'CREATE_TIME',
      key: Buffer.from('key').toString('base64'),
      value: Buffer.from(JSON.stringify(body), 'utf8').toString('base64'),
      headers: [],
    };
  }

  function mskEvent(records: MSKRecord[]): MSKEvent {
    const grouped: Record<string, MSKRecord[]> = {};
    for (const record of records) {
      const key = `${record.topic}-${record.partition}`;
      (grouped[key] ??= []).push(record);
    }
    return {
      eventSource: 'aws:kafka',
      eventSourceArn: 'arn:aws:kafka:eu-west-1:123456789012:cluster/demo/uuid',
      bootstrapServers: 'b-1.demo.kafka.eu-west-1.amazonaws.com:9092',
      records: grouped,
    };
  }

  function createContainer(): DefaultBenzeneServiceContainer {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addKafka(container);
    return container;
  }

  it('KafkaOptions defaults to partial-batch-failure reporting', () => {
    // Safe-by-default (the .NET 1.0 settlement contract): a failed partition is reported for
    // redelivery per-partition rather than the whole batch swallowed.
    const options = new KafkaOptions();
    expect(options.batchFailureMode).toBe(KafkaBatchFailureMode.PartialBatchFailure);
  });

  it('reports a returned failure result as that partition/offset resume point', async () => {
    const container = createContainer();
    const pipeline = new MiddlewarePipelineBuilder<KafkaContext>(container);
    pipeline.useFn(async (context, next) => {
      context.messageResult = { isSuccessful: false };
      await next();
    });

    const application = new KafkaApplication(pipeline.build());
    const response = await application.handleAsync(
      mskEvent([mskRecord('orders', 0, 7, { orderId: '1' })]),
      container.createServiceResolverFactory(),
    );

    expect(response.batchItemFailures).toEqual([
      { itemIdentifier: { partition: 'orders-0', offset: 7 } },
    ]);
  });

  it('reports a thrown handler exception as that partition/offset resume point', async () => {
    const container = createContainer();
    const pipeline = new MiddlewarePipelineBuilder<KafkaContext>(container);
    pipeline.useFn(() => {
      throw new Error('boom');
    });

    const application = new KafkaApplication(pipeline.build());
    const response = await application.handleAsync(
      mskEvent([mskRecord('orders', 2, 41, { orderId: '1' })]),
      container.createServiceResolverFactory(),
    );

    expect(response.batchItemFailures).toEqual([
      { itemIdentifier: { partition: 'orders-2', offset: 41 } },
    ]);
  });

  it('does NOT report a record with no established outcome (ack-on-null carve-out)', async () => {
    // CARVE-OUT — an unset outcome (typically an unroutable record) is treated as processed and
    // skipped: Kafka has no per-record DLQ, so reporting it would replay the partition from that
    // offset forever. Pinned positively per work/settlement-consistency-fix-plan.md row 14.
    const container = createContainer();
    const pipeline = new MiddlewarePipelineBuilder<KafkaContext>(container);
    pipeline.useFn(async (_context, next) => {
      await next();
    });

    const application = new KafkaApplication(pipeline.build());
    const response = await application.handleAsync(
      mskEvent([mskRecord('no-such-topic', 0, 3, { orderId: '9' })]),
      container.createServiceResolverFactory(),
    );

    expect(response.batchItemFailures).toEqual([]);
  });

  it('processes a partition sequentially in offset order and stops at the first failure', async () => {
    const container = createContainer();
    const seenOffsets: number[] = [];
    const pipeline = new MiddlewarePipelineBuilder<KafkaContext>(container);
    pipeline.useFn(async (context, next) => {
      seenOffsets.push(context.kafkaEventRecord.offset);
      context.messageResult = { isSuccessful: context.kafkaEventRecord.offset !== 11 };
      await next();
    });

    const application = new KafkaApplication(pipeline.build());
    // Deliberately out of order: the application must sort by offset (10, 11, 12), fail at 11, and
    // never run 12 — Kafka's per-partition ordering contract.
    const response = await application.handleAsync(
      mskEvent([
        mskRecord('orders', 0, 12, { orderId: 'c' }),
        mskRecord('orders', 0, 10, { orderId: 'a' }),
        mskRecord('orders', 0, 11, { orderId: 'b' }),
      ]),
      container.createServiceResolverFactory(),
    );

    expect(seenOffsets).toEqual([10, 11]);
    expect(response.batchItemFailures).toEqual([
      { itemIdentifier: { partition: 'orders-0', offset: 11 } },
    ]);
  });

  it('FailWholeBatch throws KafkaBatchProcessingException listing the failed partitions', async () => {
    const container = createContainer();
    const pipeline = new MiddlewarePipelineBuilder<KafkaContext>(container);
    pipeline.useFn(async (context, next) => {
      context.messageResult = { isSuccessful: false };
      await next();
    });

    const options = new KafkaOptions();
    options.batchFailureMode = KafkaBatchFailureMode.FailWholeBatch;
    const application = new KafkaApplication(pipeline.build(), options);

    await expect(
      application.handleAsync(
        mskEvent([mskRecord('orders', 0, 1, { orderId: '1' })]),
        container.createServiceResolverFactory(),
      ),
    ).rejects.toThrow(KafkaBatchProcessingException);
  });
});

import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { ICurrentTransport, IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { BenzeneResult } from '@benzenejs/results';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { InlineAzureFunctionStartUp } from '@benzenejs/azure-function-core';
import {
  addKafka,
  handleKafkaEvents,
  KafkaBatchApplication,
  KafkaContext,
  KafkaMessageBodyGetter,
  KafkaMessageHeadersGetter,
  KafkaMessageProcessingException,
  KafkaMessageTopicGetter,
  KafkaOptions,
  KafkaRecord,
  useKafka,
} from '@benzenejs/azure-function-kafka';

/**
 * End-to-end port of the C# Azure Kafka pipeline tests (`KafkaPipelineTest` / `KafkaGettersTest` /
 * `KafkaFailureHandlingTest`): wire the full stack via idiomatic DI and feed realistic `KafkaRecord`s
 * through the Azure Function entry point / Kafka batch application / message-handler pipeline. Kafka is
 * fire-and-forget (no response), like Service Bus/SQS. Unlike Service Bus, the routing topic comes from
 * the record's NATIVE `topic` field, so no preset/application-property topic is needed.
 */

class Order {
  orderId: string | undefined;
}

class OrderCreated {
  reference: string | undefined;
}

// Records which orders reached the handler, proving the message genuinely routed to it.
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

// A realistic KafkaRecord carries the topic in its native `topic` field and the payload as a UTF-8 byte
// value (the C# `KafkaRecord.Value` is a `byte[]` the body getter decodes).
function createRecord(topic: string, body: unknown): KafkaRecord {
  return {
    topic,
    value: Buffer.from(JSON.stringify(body), 'utf8'),
  };
}

describe('KafkaPipeline (via AzureFunctionApp entry point)', () => {
  it('routes a Kafka record to a decorated handler', async () => {
    handled.length = 0;

    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) => useKafka(builder, (k) => useMessageHandlers(k, CreateOrderHandler)))
      .build();

    await handleKafkaEvents(app, createRecord('create-order', { orderId: '42' }));

    expect(handled).toEqual(['42']);
  });

  it('processes every record in a batch', async () => {
    handled.length = 0;

    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) => useKafka(builder, (k) => useMessageHandlers(k, CreateOrderHandler)))
      .build();

    await handleKafkaEvents(
      app,
      createRecord('create-order', { orderId: '1' }),
      createRecord('create-order', { orderId: '2' }),
    );

    expect(handled.sort()).toEqual(['1', '2']);
  });
});

describe('KafkaBatchApplication (direct)', () => {
  it('runs every record through the pipeline in its own scope, with the kafka transport', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addKafka(container);

    const seenBodies: string[] = [];
    const seenTransports: string[] = [];
    const pipeline = new MiddlewarePipelineBuilder<KafkaContext>(container);
    pipeline.useFn(async (context, next, resolver) => {
      seenBodies.push(new KafkaMessageBodyGetter().getBody(context) ?? '<none>');
      seenTransports.push(resolver.getService(ICurrentTransport).name);
      await next();
    });

    const application = new KafkaBatchApplication(pipeline.build());
    await application.handleAsync(
      [createRecord('topic-a', { orderId: '1' }), createRecord('topic-b', { orderId: '2' })],
      container.createServiceResolverFactory(),
    );

    expect(seenBodies.sort()).toEqual(
      [JSON.stringify({ orderId: '1' }), JSON.stringify({ orderId: '2' })].sort(),
    );
    expect(seenTransports).toEqual(['kafka', 'kafka']);
  });

  it('raiseOnFailureStatus throws KafkaMessageProcessingException on an unsuccessful result', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addKafka(container);

    const builder = new MiddlewarePipelineBuilder<KafkaContext>(container);
    useMessageHandlers(builder, CreateOrderHandler);

    const options = new KafkaOptions();
    options.raiseOnFailureStatus = true;
    const application = new KafkaBatchApplication(builder.build(), options);

    // Unroutable topic -> handler result is not successful -> raiseOnFailureStatus throws.
    await expect(
      application.handleAsync(
        [createRecord('no-such-topic', { orderId: '9' })],
        container.createServiceResolverFactory(),
      ),
    ).rejects.toThrow(KafkaMessageProcessingException);
  });

  it('KafkaOptions defaults: does not catch exceptions, escalates failure results', () => {
    // Safe-by-default on the failure-result axis (the .NET 1.0 settlement contract):
    // raiseOnFailureStatus on, catchExceptions off.
    const options = new KafkaOptions();
    expect(options.catchExceptions).toBe(false);
    expect(options.raiseOnFailureStatus).toBe(true);
  });

  it('raiseOnFailureStatus (default): no result recorded does NOT throw (carve-out)', async () => {
    // CARVE-OUT — unlike the queue-shaped transports, a null outcome here (typically an unrouted
    // record) is NOT escalated: Kafka has no per-record dead-letter path, so retaining it would
    // replay the partition forever. See benzene-dotnet's work/settlement-consistency-fix-plan.md
    // row 15 — this test pins the carve-out so it can't be "fixed" by accident.
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addKafka(container);

    const builder = new MiddlewarePipelineBuilder<KafkaContext>(container);
    builder.useFn(async (_context, next) => {
      await next();
    });

    const application = new KafkaBatchApplication(builder.build());

    // Reaching the end without throwing proves the null outcome settled as if it had succeeded.
    await application.handleAsync(
      [createRecord('no-such-topic', { orderId: '9' })],
      container.createServiceResolverFactory(),
    );
  });
});

describe('Kafka getters', () => {
  it('KafkaMessageBodyGetter UTF-8 decodes the record value', () => {
    const context = new KafkaContext(createRecord('t', { orderId: '7' }));
    expect(new KafkaMessageBodyGetter().getBody(context)).toBe(JSON.stringify({ orderId: '7' }));
  });

  it('KafkaMessageBodyGetter maps a missing value to undefined', () => {
    const context = new KafkaContext({ topic: 't' });
    expect(new KafkaMessageBodyGetter().getBody(context)).toBeUndefined();
  });

  it('KafkaMessageTopicGetter reads the native topic name', () => {
    const context = new KafkaContext(createRecord('orders-topic', {}));
    expect(new KafkaMessageTopicGetter().getTopic(context)?.id).toBe('orders-topic');
  });

  it('KafkaMessageHeadersGetter is always empty', () => {
    const context = new KafkaContext(createRecord('t', {}));
    expect(new KafkaMessageHeadersGetter().getHeaders(context)).toEqual({});
  });
});

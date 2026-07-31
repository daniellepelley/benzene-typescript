import { describe, expect, it } from 'vitest';
import type { EachMessagePayload } from 'kafkajs';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzene/abstractions';
import { IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { message, MessageHandlersRegistry, useMessageHandlers } from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { IBenzeneMessageSender } from '@benzene/clients';
import { useWorker, WorkerApplicationBuilder } from '@benzene/self-host';
import {
  IKafkaConsumerFactory,
  KafkaApplication,
  KafkaRecordContext,
  useKafka,
} from '@benzene/kafka-core';
import { FakeBenzeneMessageSender } from '@benzene/testing';

/**
 * Regression test for the type-erasure routing fix: booting the full `useKafka(...)` +
 * `useMessageHandlers(...)` wiring must route a native record to the decorated handler. Before the fix,
 * `useKafka` registered `addBenzeneMessage`, whose `BenzeneMessageGetter` won the erased `IMessageGetter`
 * token and hijacked routing over the Kafka getters. Drives the real `KafkaApplication` the wiring
 * registers, without a broker.
 */

const Topics = { placeOrder: 'order:place', orderCreated: 'order:created' } as const;
const registry = new MessageHandlersRegistry();

class PlaceOrder {
  name?: string;
}
class OrderDto {
  name?: string;
}

@message(Topics.placeOrder, { registry, requestType: PlaceOrder, responseType: OrderDto })
class PlaceOrderHandler implements IMessageHandler<PlaceOrder, OrderDto> {
  static readonly inject = [IBenzeneMessageSender];
  constructor(private readonly sender: IBenzeneMessageSender) {}
  async handleAsync(request: PlaceOrder): Promise<IBenzeneResultOf<OrderDto>> {
    await this.sender.sendAsync(Topics.orderCreated, { name: request.name });
    return BenzeneResult.ok<OrderDto>({ name: request.name });
  }
}

const noopConsumerFactory: IKafkaConsumerFactory = {
  create: () => {
    throw new Error('the Kafka consumer should not be created by this test');
  },
};

function record(topic: string, value: string): EachMessagePayload {
  return {
    topic,
    partition: 0,
    message: { value: Buffer.from(value, 'utf8'), offset: '1', headers: undefined, key: null },
  } as unknown as EachMessagePayload;
}

describe('useKafka + useMessageHandlers routing', () => {
  it('routes a native record to the decorated handler through the real KafkaApplication', async () => {
    const fake = new FakeBenzeneMessageSender();
    const container = new DefaultBenzeneServiceContainer();
    container.addSingletonInstance(IBenzeneMessageSender, fake);

    const app: IBenzeneApplicationBuilder = new WorkerApplicationBuilder(container);
    useWorker(app, (workers) =>
      useKafka(workers, { topics: [Topics.placeOrder] }, noopConsumerFactory, (kafka) => {
        useMessageHandlers(kafka, PlaceOrderHandler);
      }),
    );

    const resolverFactory = container.createServiceResolverFactory();
    const application = resolverFactory.createScope().getService(KafkaApplication) as KafkaApplication;

    const result = await application.handleAsync(
      record(Topics.placeOrder, JSON.stringify({ name: 'acme' })),
      resolverFactory,
    );

    expect(result).toBeDefined();
    expect(result!.isSuccessful).toBe(true);
    expect(fake.lastTopic).toBe(Topics.orderCreated);
    expect(fake.lastRequest).toMatchObject({ name: 'acme' });
  });
});

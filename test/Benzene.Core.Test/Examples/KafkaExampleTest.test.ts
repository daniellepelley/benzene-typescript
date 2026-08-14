/**
 * Drives `@benzene-example/kafka` end-to-end in-memory (no broker). Two halves, matching the .NET
 * `Benzene.Examples.Kafka` (consumer worker + producer):
 *
 *  - CONSUMER: boot the real `KafkaOrdersStartUp` with `benzeneTestHost(StartUp).buildKafkaWorkerHost()`,
 *    override the order store with a test-owned instance, and push native `asKafkaBenzeneMessage(...)`
 *    records through the front door — asserting each record routes to its handler and mutates the store.
 *  - PRODUCER: drive `createOrderProducer` over a FAKE kafkajs `Producer`, asserting the produced record's
 *    topic and JSON body (the port's send-side test seam).
 */
import { describe, expect, it, vi } from 'vitest';
import type { Producer, ProducerRecord, RecordMetadata } from 'kafkajs';
import { sendMessageAsync } from '@benzenejs/clients';
import { BenzeneResultStatus } from '@benzenejs/results';
import { benzeneTestHost, messageBuilder } from '@benzenejs/testing';
import { asKafkaBenzeneMessage } from '@benzenejs/kafka-core-test-helpers';
import {
  createOrderProducer,
  InMemoryOrderStore,
  IOrderStore,
  KafkaOrdersStartUp,
  Topics,
} from '@benzene-example/kafka';

function fakeProducer(): { producer: Producer; lastRecord: () => ProducerRecord | undefined } {
  let last: ProducerRecord | undefined;
  const send = vi.fn(async (record: ProducerRecord): Promise<RecordMetadata[]> => {
    last = record;
    return [{ topicName: record.topic, partition: 0, errorCode: 0 }];
  });
  return { producer: { send } as unknown as Producer, lastRecord: () => last };
}

describe('@benzene-example/kafka', () => {
  describe('consumer worker (front door, no broker)', () => {
    it('routes an order_create record to the handler and persists the order', async () => {
      const store = new InMemoryOrderStore();
      const host = benzeneTestHost(KafkaOrdersStartUp)
        .withServices((services) => services.addSingletonInstance(IOrderStore, store))
        .buildKafkaWorkerHost();

      const result = await host.handleAsync(
        asKafkaBenzeneMessage(messageBuilder(Topics.orderCreate, { status: 'new', name: 'Acme' })),
      );

      expect(result?.isSuccessful).toBe(true);
      expect(store.orders).toHaveLength(1);
      expect(store.orders[0]).toMatchObject({ status: 'new', name: 'Acme' });
    });

    it('routes an order_delete record to the handler and removes the order', async () => {
      const store = new InMemoryOrderStore();
      store.add({ id: 'order-1', status: 'new', name: 'Acme' });
      const host = benzeneTestHost(KafkaOrdersStartUp)
        .withServices((services) => services.addSingletonInstance(IOrderStore, store))
        .buildKafkaWorkerHost();

      await host.handleAsync(asKafkaBenzeneMessage(messageBuilder(Topics.orderDelete, { id: 'order-1' })));

      expect(store.orders).toHaveLength(0);
    });
  });

  describe('producer client (fake kafkajs Producer)', () => {
    it('produces to the order_create topic with the JSON body', async () => {
      const { producer, lastRecord } = fakeProducer();
      const client = createOrderProducer(producer);

      const result = await sendMessageAsync(client, Topics.orderCreate, { status: 'new', name: 'Acme' });

      expect(result.status).toBe(BenzeneResultStatus.accepted);
      const record = lastRecord();
      expect(record?.topic).toBe(Topics.orderCreate);
      expect(record?.messages[0]?.value).toBe(JSON.stringify({ status: 'new', name: 'Acme' }));
    });
  });
});

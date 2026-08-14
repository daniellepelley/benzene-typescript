/**
 * The composition root for the Kafka consumer worker — port of the .NET `Benzene.Examples.Kafka` `StartUp`.
 * `configureServices` registers the order domain's store; `configure` mounts a long-running Kafka consumer
 * worker (`useKafka`) that subscribes to the order topics and routes each record to the matching handler.
 *
 * The caller builds the kafkajs `Consumer` (brokers, group id, auth) and hands it to the worker via an
 * `IKafkaConsumerFactory` — see `kafkaConsumerFactory` below. A component test boots this same StartUp with
 * `benzeneTestHost(StartUp).buildKafkaWorkerHost()` and pushes native records through the front door, so no
 * broker is created under test.
 */
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { useMessageHandlers } from '@benzenejs/core-message-handlers';
import { IKafkaConsumerFactory, useKafka } from '@benzenejs/kafka-core';
import { useWorker } from '@benzenejs/self-host';
import { Kafka } from 'kafkajs';
import type { BenzeneStartUp } from '@benzenejs/testing';
import { CreateOrderHandler, DeleteOrderHandler, Topics } from './handlers';
import { IOrderStore, InMemoryOrderStore } from './orderStore';

/**
 * An `IKafkaConsumerFactory` that lazily builds a real kafkajs `Consumer` for a deployed worker — the
 * caller-owns-the-consumer seam. Construction is deferred into `create()` (which only the running worker
 * calls), so booting this StartUp under a component test never touches kafkajs.
 */
export function kafkaConsumerFactory(
  brokers: string[] = ['localhost:9092'],
  groupId = 'benzene-example-kafka',
): IKafkaConsumerFactory {
  return {
    create: () => new Kafka({ clientId: 'benzene-example-kafka', brokers }).consumer({ groupId }),
  };
}

export class KafkaOrdersStartUp implements BenzeneStartUp {
  constructor(private readonly consumerFactory: IKafkaConsumerFactory = kafkaConsumerFactory()) {}

  configureServices(services: IBenzeneServiceContainer): void {
    services.addSingleton(IOrderStore, InMemoryOrderStore);
    // The Benzene baseline is ensured idempotently by useMessageHandlers (in `configure`).
  }

  configure(app: IBenzeneApplicationBuilder): void {
    useWorker(app, (workers) =>
      useKafka(
        workers,
        { topics: [Topics.orderCreate, Topics.orderDelete], fromBeginning: true },
        this.consumerFactory,
        (kafka) => useMessageHandlers(kafka, CreateOrderHandler, DeleteOrderHandler),
      ),
    );
  }
}

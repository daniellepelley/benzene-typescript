/**
 * The Kafka leg: a long-running worker process consuming one topic, dispatching every record to the
 * same `PlaceOrderHandler` `api.ts` exposes over HTTP and `sqsWorker.ts` exposes over SQS. The Kafka
 * consumer routes by the record's **literal** Kafka topic name against a handler's `@message(...)`
 * value — no colon-separated topic-id convention the way HTTP/SQS have one — which is why the shared
 * handler is registered under the Kafka-legal `"order-place"` rather than a colon-style topic (see
 * `domain.ts`'s comment).
 *
 * Run with:
 *
 *     KAFKA_BROKERS=localhost:9092 npm run start:kafka-worker -w @benzene-example/k8s-orders
 */
import { Kafka } from 'kafkajs';
import { IKafkaConsumerFactory, useKafka } from '@benzene/kafka-core';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { InlineSelfHostedStartUp } from '@benzene/self-host';
import { PLACE_ORDER_TOPIC, PlaceOrderHandler } from './domain.js';

const brokers = (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(',');

const consumerFactory: IKafkaConsumerFactory = {
  create: () =>
    new Kafka({ clientId: 'orders-kafka-worker', brokers }).consumer({
      groupId: 'orders-kafka-worker',
    }),
};

export function buildKafkaWorker() {
  return new InlineSelfHostedStartUp()
    .configure((app) =>
      useKafka(app, { topics: [PLACE_ORDER_TOPIC], fromBeginning: true }, consumerFactory, (kafka) =>
        useMessageHandlers(kafka, PlaceOrderHandler),
      ),
    )
    .build();
}

async function main(): Promise<void> {
  const worker = buildKafkaWorker();
  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort());
  process.on('SIGTERM', () => controller.abort());

  console.log(`orders-kafka-worker consuming topic "${PLACE_ORDER_TOPIC}" on ${brokers.join(',')}`);
  await worker.startAsync(controller.signal);
}

const isMain = process.argv[1] !== undefined && import.meta.url === new URL(process.argv[1], 'file://').href;
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}

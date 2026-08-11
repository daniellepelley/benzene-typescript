/**
 * The Kafka leg: a consumer that shares the process `app.ts` starts, consuming one topic and
 * dispatching every record to the same `PlaceOrderHandler` the HTTP and SQS legs expose. The Kafka
 * consumer routes by the record's **literal** Kafka topic name against a handler's `@message(...)`
 * value — no colon-separated topic-id convention the way HTTP/SQS have one — which is why the shared
 * handler is registered under the Kafka-legal `"order-place"` rather than a colon-style topic (see
 * `domain.ts`'s comment).
 *
 * Exports `buildKafkaWorker()` only — see `app.ts` for how it's started. Unlike the SQS leg,
 * kafkajs's `consumer.run` is push-based, so `startAsync` here resolves promptly (after
 * connect/subscribe/join) rather than blocking until stopped — but it's still started
 * fire-and-forget, for the same reason and the same shape as the SQS leg.
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

export const kafkaBrokers = brokers;

export function buildKafkaWorker() {
  return new InlineSelfHostedStartUp()
    .configure((app) =>
      useKafka(app, { topics: [PLACE_ORDER_TOPIC], fromBeginning: true }, consumerFactory, (kafka) =>
        useMessageHandlers(kafka, PlaceOrderHandler),
      ),
    )
    .build();
}

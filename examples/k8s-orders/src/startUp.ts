/**
 * The whole service in one startup: HTTP, SQS, and Kafka wired as three peer workers, all dispatching
 * to the same `PlaceOrderHandler`. Everything about hosting lives here — `src/app.ts` is one line and
 * would not change if a fourth transport were added, which is the point of keeping hosting in the
 * startup rather than the entry point.
 *
 * Direct counterpart of the .NET example's `examples/K8sTransports/App/Startup.cs`.
 */
import { SQSClient } from '@aws-sdk/client-sqs';
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import {
  BenzeneConfiguration,
  BenzeneStartUp,
  IBenzeneApplicationBuilder,
} from '@benzenejs/abstractions-middleware';
import { SqsClientFactory, useSqs } from '@benzenejs/aws-sqs';
import { useMessageHandlers } from '@benzenejs/core-message-handlers';
import { useExpress } from '@benzenejs/express';
import { useKafka } from '@benzenejs/kafka-core';
import { useWorker } from '@benzenejs/self-host';
import { Kafka } from 'kafkajs';
import { PLACE_ORDER_TOPIC, PlaceOrderHandler } from './domain.js';

function required(configuration: BenzeneConfiguration, key: string): string {
  const value = configuration.get(key);
  if (value === undefined || value === '') {
    throw new Error(`${key} is not set`);
  }
  return value;
}

export class OrdersStartUp implements BenzeneStartUp {
  getConfiguration(): BenzeneConfiguration {
    return { get: (key) => process.env[key] };
  }

  configureServices(_services: IBenzeneServiceContainer, _configuration: BenzeneConfiguration): void {}

  configure(app: IBenzeneApplicationBuilder, configuration: BenzeneConfiguration): void {
    // A LocalStack/emulator endpoint is opt-in via SQS_ENDPOINT_URL (see compose/docker-compose.yml);
    // unset (the real-AWS/EKS case), the SQSClient falls through to the SDK's default credential chain —
    // an IRSA-mapped pod service account on EKS, same as every other Benzene AWS client.
    const sqsEndpointUrl = configuration.get('SQS_ENDPOINT_URL');
    const sqsClient = new SQSClient(sqsEndpointUrl !== undefined ? { endpoint: sqsEndpointUrl } : {});
    const brokers = (configuration.get('KAFKA_BROKERS') ?? 'localhost:9092').split(',');

    // Three transports, three use* calls, one worker host. Every leg wires the handler itself — this
    // port has no reflection-based handler discovery, so "shared" means "the same class imported once,
    // wired three times", not "auto-discovered".
    useWorker(app, (workers) => {
      useExpress(workers, { port: Number(configuration.get('PORT') ?? 8080) }, (http) =>
        useMessageHandlers(http, PlaceOrderHandler),
      );

      useSqs(
        workers,
        { queueUrl: required(configuration, 'QUEUE_URL'), maxNumberOfMessages: 10 },
        new SqsClientFactory(sqsClient),
        (sqs) => useMessageHandlers(sqs, PlaceOrderHandler),
      );

      useKafka(
        workers,
        { topics: [PLACE_ORDER_TOPIC], fromBeginning: true },
        { create: () => new Kafka({ clientId: 'orders', brokers }).consumer({ groupId: 'orders' }) },
        (kafka) => useMessageHandlers(kafka, PlaceOrderHandler),
      );
    });
  }
}

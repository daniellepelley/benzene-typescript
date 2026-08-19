/**
 * The whole entry point for the consumer worker. `KafkaOrdersStartUp` declares the Kafka consumer
 * (`useWorker` + `useKafka` — see `startUp.ts`), so this file names no transport and would not change
 * if the service grew a second one.
 *
 * Run with:
 *
 *     KAFKA_BROKERS=localhost:9092 npm start -w @benzene-example/kafka
 */
import { BenzeneHost } from '@benzenejs/self-host';
import { KafkaOrdersStartUp } from './startUp';

await BenzeneHost.runAsync(KafkaOrdersStartUp);

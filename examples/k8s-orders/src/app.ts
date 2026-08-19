/**
 * The whole entry point. `OrdersStartUp` declares all three transports (HTTP, SQS, Kafka) as workers —
 * see `startUp.ts` — and this file would not change if a fourth were added.
 *
 * Run with:
 *
 *     QUEUE_URL=http://localhost:4566/000000000000/orders-in KAFKA_BROKERS=localhost:9092 \
 *       npm start -w @benzene-example/k8s-orders
 */
import { BenzeneHost } from '@benzenejs/self-host';
import { OrdersStartUp } from './startUp.js';

await BenzeneHost.runAsync(OrdersStartUp);

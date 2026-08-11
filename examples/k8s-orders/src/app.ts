/**
 * The one entry point: starts the Express order API, the SQS poller, and the Kafka consumer
 * together in this one process, all three dispatching into the same `PlaceOrderHandler`.
 *
 * The SQS and Kafka legs are started fire-and-forget, NOT awaited inline before `app.listen()`.
 * `sqsWorker.ts`'s `startAsync` is its own poll loop and does not resolve until stopped — `await`ing
 * it here would mean `app.listen()` never runs at all, the same starvation bug the .NET port hit
 * combining a blocking worker with Kestrel in one process (see
 * `../../../docs/getting-started-kubernetes.md`). Node has no such sequencing to work around by
 * design — the event loop schedules `app.listen()`'s callback independently of a pending promise
 * elsewhere — but only once `app.listen()` is actually *called*, which a sequential `await` above it
 * would prevent. `kafkaWorker.ts`'s `startAsync` resolves promptly on its own (kafkajs is
 * push-based), but is started the same way for consistency and so a startup failure is caught
 * rather than becoming an unhandled rejection.
 *
 * Run with:
 *
 *     QUEUE_URL=http://localhost:4566/000000000000/orders-in KAFKA_BROKERS=localhost:9092 \
 *       npm start -w @benzene-example/k8s-orders
 */
import { createOrderApp } from './httpApp.js';
import { buildSqsWorker, sqsQueueUrl } from './sqsWorker.js';
import { buildKafkaWorker, kafkaBrokers } from './kafkaWorker.js';

const controller = new AbortController();
process.on('SIGINT', () => controller.abort());
process.on('SIGTERM', () => controller.abort());

console.log(`orders-sqs-worker polling ${sqsQueueUrl}`);
void buildSqsWorker()
  .startAsync(controller.signal)
  .catch((err: unknown) => {
    console.error('orders-sqs-worker failed', err);
    process.exit(1);
  });

console.log(`orders-kafka-worker consuming topic "order-place" on ${kafkaBrokers.join(',')}`);
void buildKafkaWorker()
  .startAsync(controller.signal)
  .catch((err: unknown) => {
    console.error('orders-kafka-worker failed', err);
    process.exit(1);
  });

const port = Number(process.env['PORT'] ?? 8080);
createOrderApp().listen(port, () => {
  console.log(`orders-api listening on http://localhost:${port}`);
});

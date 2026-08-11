/**
 * `@benzene-example/k8s-orders` — one order-placement handler (`domain.ts`), hosted three independent
 * ways (`api.ts` over HTTP, `sqsWorker.ts` over SQS, `kafkaWorker.ts` over Kafka), each its own
 * Kubernetes Deployment. See `README.md` and `../../docs/getting-started-kubernetes.md`.
 */
export * from './domain.js';
export * from './httpApp.js';

/**
 * `@benzene-example/k8s-orders` — one order-placement handler (`domain.ts`), hosted three ways at once
 * (HTTP, SQS and Kafka) by one `OrdersStartUp` (`startUp.ts`) in one Kubernetes Deployment. See
 * `README.md` and `../../docs/getting-started-kubernetes.md`.
 */
export * from './domain.js';
export * from './startUp.js';

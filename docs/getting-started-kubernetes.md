# Getting Started: Benzene on Kubernetes

This guide takes you from an empty folder to **one handler, reached over HTTP, SQS, and Kafka,
hosted in a single Node process**. That's deliberately more than "deploy Express to a pod": see
[Why not just Express?](getting-started.md#why-not-just-express) for why a single-transport example
wouldn't actually show what Benzene is for here.

> **Runnable version:** this guide follows [`examples/k8s-orders`](../examples/k8s-orders) — a
> Dockerfile, a Kubernetes manifest, and a `docker-compose.yml` that runs all three legs locally
> against LocalStack + a throwaway Kafka broker, no cloud account needed.

## What you'll build

```
        HTTP        ─────────┐
        SQS queue   ─────────┼──▶  orders-app (Deployment)  ──▶  PlaceOrderHandler
        Kafka topic ─────────┘
```

One handler class, imported once by one entry point script that starts an Express server, an SQS
poller, and a Kafka consumer together — one container image, one Kubernetes Deployment.

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and npm, and Docker.
- A cluster and `kubectl` — [kind](https://kind.sigs.k8s.io/) is the quickest for local work
  (`kind create cluster`).
- To follow along with real messages rather than just reading: an SQS queue and a Kafka topic
  somewhere reachable (LocalStack and a throwaway broker via `docker compose` cover both with no
  account at all — see the [runnable example](../examples/k8s-orders)).

## 1. The shared handler

Everything downstream imports this one class. This port has no reflection-based handler discovery
(see [Getting started](getting-started.md#3-write-a-message-handler)), so "shared" means a plain
class each leg registers explicitly, not something auto-discovered:

```ts
// src/domain.ts
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message, MessageHandlersRegistry } from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { BenzeneResult } from '@benzene/results';

export const registry = new MessageHandlersRegistry();
export const PLACE_ORDER_TOPIC = 'order-place';

export class PlaceOrderRequest {
  customerId = '';
  sku = '';
  quantity = 0;
}

export class OrderPlaced {
  orderId = '';
  status = '';
}

@httpEndpoint('POST', '/orders')
@message(PLACE_ORDER_TOPIC, { registry, requestType: PlaceOrderRequest, responseType: OrderPlaced })
export class PlaceOrderHandler implements IMessageHandler<PlaceOrderRequest, OrderPlaced> {
  handleAsync(request: PlaceOrderRequest): Promise<IBenzeneResultOf<OrderPlaced>> {
    const orderId = `order-${crypto.randomUUID().slice(0, 8)}`;
    console.log(`order placed: ${orderId} - ${request.quantity}x ${request.sku}`);
    return Promise.resolve(BenzeneResult.created<OrderPlaced>({ orderId, status: 'placed' }));
  }
}
```

Nothing here mentions Kubernetes, SQS, Kafka, or an HTTP request/response — that's the point of a
message handler in Benzene's hexagonal architecture: the domain logic sits behind a port, and a
transport is just an adapter in front of it. Stacking `@httpEndpoint` and `@message` on the same
class is what lets all three legs below register it unmodified.

The **Benzene topic must equal the Kafka topic name literally** — there is no colon-separated
topic-id convention on Kafka the way there is for HTTP (see [Kafka
Setup](getting-started-kafka.md)). That's why `order-place` was picked over the colon-style
`order:place` this port otherwise favors: Kafka topic names may not contain `:`.

## 2. Build each leg, then start them together

Each leg is its own small module exporting a `build*` function — no entry-point code of its own:

```ts
// src/httpApp.ts
import express, { type Express } from 'express';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { benzene } from '@benzene/express';
import { PlaceOrderHandler } from './domain.js';

export function createOrderApp(): Express {
  const app = express();
  app.use(benzene((pipeline) => useMessageHandlers(pipeline, PlaceOrderHandler)));
  return app;
}
```

```ts
// src/sqsWorker.ts
import { SQSClient } from '@aws-sdk/client-sqs';
import { SqsClientFactory, useSqs } from '@benzene/aws-sqs';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { InlineSelfHostedStartUp } from '@benzene/self-host';
import { PlaceOrderHandler } from './domain.js';

const queueUrl = process.env['QUEUE_URL']!;
const sqsClient = new SQSClient(); // default credential chain - an IRSA role on EKS

export function buildSqsWorker() {
  return new InlineSelfHostedStartUp()
    .configure((app) =>
      useSqs(app, { queueUrl, maxNumberOfMessages: 10 }, new SqsClientFactory(sqsClient), (sqs) =>
        useMessageHandlers(sqs, PlaceOrderHandler),
      ),
    )
    .build();
}
```

```ts
// src/kafkaWorker.ts
import { Kafka } from 'kafkajs';
import { useKafka } from '@benzene/kafka-core';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { InlineSelfHostedStartUp } from '@benzene/self-host';
import { PLACE_ORDER_TOPIC, PlaceOrderHandler } from './domain.js';

const brokers = (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(',');
const consumerFactory = {
  create: () => new Kafka({ clientId: 'orders-kafka-worker', brokers }).consumer({
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
```

Now the one entry point that starts all three — and the one thing in this whole guide that's easy to
get wrong:

```ts
// src/app.ts
import { createOrderApp } from './httpApp.js';
import { buildSqsWorker } from './sqsWorker.js';
import { buildKafkaWorker } from './kafkaWorker.js';

const controller = new AbortController();
process.on('SIGINT', () => controller.abort());
process.on('SIGTERM', () => controller.abort());

// NOT awaited inline. SqsConsumer.startAsync IS its poll loop - it doesn't resolve until stopped.
// `await`ing it here would mean app.listen() below never runs at all.
void buildSqsWorker().startAsync(controller.signal).catch((err: unknown) => {
  console.error('orders-sqs-worker failed', err);
  process.exit(1);
});

// kafkajs's consumer.run is push-based, so this resolves promptly on its own - but it's started the
// same fire-and-forget way for consistency, and so a startup failure is caught.
void buildKafkaWorker().startAsync(controller.signal).catch((err: unknown) => {
  console.error('orders-kafka-worker failed', err);
  process.exit(1);
});

const port = Number(process.env['PORT'] ?? 8080);
createOrderApp().listen(port, () => console.log(`orders-api listening on http://localhost:${port}`));
```

Node has no "generic host" sequencing startup the way .NET's does (that port's version of this guide
has to work around a real bug there: a self-hosted worker's `startAsync` starving Kestrel's own
startup — see its [Kubernetes guide](https://github.com/daniellepelley/benzene-dotnet/blob/main/docs/getting-started-kubernetes.md)
if you're curious). The event loop schedules `app.listen()`'s callback independently of a pending
promise elsewhere — **but only once `app.listen()` is actually called**, and a sequential `await
buildSqsWorker().startAsync(...)` placed *before* it would prevent that call from ever being reached,
the same practical effect as the .NET bug by a different mechanism. `void
promise.catch(...)` — never `await` — is what keeps all three legs independent.

## 3. Containerise it

One process, one `Dockerfile`, one image. Because `@benzene/*` packages are resolved as npm
workspace siblings rather than published packages, the build context has to be the whole monorepo
checkout, not just `examples/k8s-orders/`:

```dockerfile
# Dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY src ./src
COPY examples/k8s-orders ./examples/k8s-orders
RUN npm install

ENV PORT=8080
EXPOSE 8080
CMD ["npx", "tsx", "examples/k8s-orders/src/app.ts"]
```

```bash
docker build -f Dockerfile -t k8s-orders:local .
kind load docker-image k8s-orders:local
```

## 4. Deploy it

One `Deployment` + `Service` — the SQS and Kafka legs don't get their own, because nothing calls this
pod over either of them; it calls out:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-app
spec:
  replicas: 2
  selector: { matchLabels: { app: orders-app } }
  template:
    metadata: { labels: { app: orders-app } }
    spec:
      containers:
        - name: orders-app
          image: k8s-orders:local
          ports: [{ containerPort: 8080 }]
          env:
            - { name: PORT, value: "8080" }
            - { name: QUEUE_URL, value: "https://sqs.eu-west-1.amazonaws.com/<account-id>/orders-in" }
            - { name: KAFKA_BROKERS, value: "kafka-bootstrap.kafka.svc.cluster.local:9092" }
          readinessProbe: { httpGet: { path: /healthz, port: 8080 }, initialDelaySeconds: 3 }
---
apiVersion: v1
kind: Service
metadata:
  name: orders-app
spec:
  selector: { app: orders-app }
  ports: [{ port: 80, targetPort: 8080 }]
```

```bash
kubectl apply -f k8s.yaml
kubectl get pods   # 2 pods: 2x orders-app
```

## 5. Watch the same handler run three ways

```bash
kubectl port-forward service/orders-app 8080:80 &
curl -XPOST localhost:8080/orders -H 'content-type: application/json' \
     -d '{"customerId":"c-1","sku":"widget","quantity":3}'
```

Send a message to the SQS queue or the Kafka topic directly (see [the runnable
example](../examples/k8s-orders) for exact commands against a local LocalStack/Kafka pair) and the
**same handler** runs, for a request that never touched HTTP — `kubectl logs deploy/orders-app` shows
it. That's the proof: one handler, one container, three transports.

```bash
kubectl scale deploy/orders-app --replicas=4   # scales all three transports' consuming capacity together
```

## One process, or one per transport?

This guide combines all three transports into a single process because Node's event loop makes it
cheap to, once you know the one rule above (fire-and-forget, never await a long-running `startAsync`
inline). It is not the *only* shape, though, and it is not always the right one. Splitting the
transports into **separate** entry points/Deployments (one for HTTP, one for the SQS poller, one for
the Kafka consumer, each its own image) is a legitimate alternative: each transport then scales,
rolls back, and fails independently — a bad Kafka-consumer deploy, or the Kafka leg falling behind
under load, no longer risks the HTTP leg's availability the way it does when a crash or an
unresponsive event loop is shared between all three. The tradeoff is real too: more images to build,
more Deployments to manage, and a little duplicated startup wiring per transport. `src/domain.ts`
doesn't change either way — only how many entry points and Dockerfiles wrap it. Reach for separate
Deployments when the transports' traffic, failure modes, or scaling needs genuinely diverge; reach
for one process when they don't and the operational simplicity of a single image/Deployment is worth
more than that independence.

## Next steps

- **Why this shape at all** — [Why not just Express?](getting-started.md#why-not-just-express).
- **More self-hosted workers** — [Kafka Setup](getting-started-kafka.md) covers `useKafka` in depth;
  `@benzene/aws-sqs` is documented in its own package. Both are worth reaching for even as a
  service's *only* transport, since neither's raw client (kafkajs, aws-sdk) gives you routing or a
  middleware pipeline the way Express gives HTTP.
- **The cloud hosts** — [AWS Lambda](getting-started-aws.md) and
  [Azure Functions](getting-started-azure.md) run the same handler behind a managed event source
  instead of a self-hosted poller.

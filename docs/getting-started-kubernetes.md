# Getting Started: Benzene on Kubernetes

This guide takes you from an empty folder to **one handler running as three independent Kubernetes
Deployments** — an HTTP API, an SQS worker, and a Kafka worker — all dispatching into the exact same
class. That's deliberately more than "deploy an Express server to a pod": see
[Why not just Express?](getting-started.md#why-not-just-express) for why a single-transport example
wouldn't actually show what Benzene is for here.

> **Runnable version:** this guide follows [`examples/k8s-orders`](../examples/k8s-orders) —
> Dockerfiles, Kubernetes manifests, and a `docker-compose.yml` that runs all three legs locally
> against LocalStack + a throwaway Kafka broker, no cloud account needed.

## What you'll build

```
                              ┌──────────────────────────────────────┐
        HTTP  ──────────────▶│  orders-api           (Deployment)    │──┐
                              └──────────────────────────────────────┘  │
                              ┌──────────────────────────────────────┐  │   all three dispatch
        SQS queue  ─────────▶│  orders-sqs-worker    (Deployment)    │──┼──▶ PlaceOrderHandler
                              └──────────────────────────────────────┘  │
                              ┌──────────────────────────────────────┐  │
        Kafka topic  ───────▶│  orders-kafka-worker  (Deployment)    │──┘
                              └──────────────────────────────────────┘
```

One shared handler module, imported by three separate entry point scripts, each its own container
image, each its own Kubernetes Deployment, each independently replicated and scaled.

## Prerequisites

- [Node.js 22+](https://nodejs.org/), npm, and Docker.
- A cluster and `kubectl` — [kind](https://kind.sigs.k8s.io/) is the quickest for local work
  (`kind create cluster`).
- To follow along with real messages rather than just reading: an SQS queue and a Kafka topic
  somewhere reachable (LocalStack and a throwaway broker via `docker compose` cover both with no
  account at all — see the [runnable example](../examples/k8s-orders)).

## 1. The shared handler

Everything downstream imports this one file. This port has no reflection-based handler discovery
(see [Getting started](getting-started.md#3-write-a-message-handler)), so "shared" means a plain
class each host registers explicitly, not something auto-discovered:

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
class is what lets all three entry points below register it unmodified.

The **Benzene topic must equal the Kafka topic name literally** — there is no colon-separated
topic-id convention on Kafka the way there is for HTTP (see [Kafka
Setup](getting-started-kafka.md)). That's why `order-place` was picked over the colon-style
`order:place` this port otherwise favors: Kafka topic names may not contain `:`.

## 2. Host it over HTTP

```ts
// src/api.ts
import express from 'express';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { benzene } from '@benzene/express';
import { PlaceOrderHandler } from './domain.js';

const app = express();
app.use(benzene((pipeline) => useMessageHandlers(pipeline, PlaceOrderHandler)));

const port = Number(process.env['PORT'] ?? 8080);
app.listen(port, () => console.log(`orders-api listening on http://localhost:${port}`));
```

This is exactly [Getting started](getting-started.md) — nothing here is Kubernetes-specific yet.

## 3. Host it on SQS

A second, completely independent entry point, sharing nothing with `api.ts` except the import of
`domain.ts`:

```ts
// src/sqsWorker.ts
import { SQSClient } from '@aws-sdk/client-sqs';
import { SqsClientFactory, useSqs } from '@benzene/aws-sqs';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { InlineSelfHostedStartUp } from '@benzene/self-host';
import { PlaceOrderHandler } from './domain.js';

const queueUrl = process.env['QUEUE_URL'];
if (!queueUrl) throw new Error('QUEUE_URL environment variable is required');

const sqsClient = new SQSClient(); // default credential chain - an IRSA role on EKS

const worker = new InlineSelfHostedStartUp()
  .configure((app) =>
    useSqs(app, { queueUrl, maxNumberOfMessages: 10 }, new SqsClientFactory(sqsClient), (sqs) =>
      useMessageHandlers(sqs, PlaceOrderHandler),
    ),
  )
  .build();

const controller = new AbortController();
process.on('SIGINT', () => controller.abort());
process.on('SIGTERM', () => controller.abort());
await worker.startAsync(controller.signal);
```

`@benzene/aws-sqs`'s `useSqs` is a long-running poller — the self-hosted counterpart of the
Lambda-trigger `@benzene/aws-lambda-sqs`, and the right shape for a pod that stays up. It long-polls
the queue, runs each message through the same pipeline `api.ts` uses, and by default only deletes
the messages whose handler reported success — a failed message is left on the queue individually for
redelivery/DLQ redrive rather than lost with the rest of the batch.

## 4. Host it on Kafka

A third entry point, independent of the other two:

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

const worker = new InlineSelfHostedStartUp()
  .configure((app) =>
    useKafka(app, { topics: [PLACE_ORDER_TOPIC], fromBeginning: true }, consumerFactory, (kafka) =>
      useMessageHandlers(kafka, PlaceOrderHandler),
    ),
  )
  .build();

const controller = new AbortController();
process.on('SIGINT', () => controller.abort());
process.on('SIGTERM', () => controller.abort());
await worker.startAsync(controller.signal);
```

Unlike the SQS leg, kafkajs's `consumer.run` is push-based, so `startAsync` here can return before
the worker is actually done — but the process stays alive regardless, because the live kafkajs
connection (sockets, reconnect timers) keeps the Node event loop running. Either way, `await
worker.startAsync(...)` plus the two signal handlers is the whole shutdown story: no separate "keep
the process alive" hack needed.

## 5. Containerise all three

Each entry point gets its own `Dockerfile`. Because `@benzene/*` packages are resolved as npm
workspace siblings rather than published packages, the build context has to be the whole monorepo
checkout, not just `examples/k8s-orders/`:

```dockerfile
# Dockerfile.api
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY src ./src
COPY examples/k8s-orders ./examples/k8s-orders
RUN npm install

ENV PORT=8080
EXPOSE 8080
CMD ["npx", "tsx", "examples/k8s-orders/src/api.ts"]
```

`Dockerfile.sqsWorker` and `Dockerfile.kafkaWorker` follow the same shape, swapping the final `CMD` —
a worker has no inbound listener, so there's no `PORT`/`EXPOSE` to set.

```bash
docker build -f Dockerfile.api         -t orders-api:local         .
docker build -f Dockerfile.sqsWorker   -t orders-sqs-worker:local   .
docker build -f Dockerfile.kafkaWorker -t orders-kafka-worker:local .
kind load docker-image orders-api:local orders-sqs-worker:local orders-kafka-worker:local
```

## 6. Deploy all three

`orders-api` gets a `Deployment` + `Service`, same as any HTTP workload. The two workers get a
`Deployment` each and **no** `Service` — nothing calls a worker pod, it calls out:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
spec:
  replicas: 2
  selector: { matchLabels: { app: orders-api } }
  template:
    metadata: { labels: { app: orders-api } }
    spec:
      containers:
        - name: orders-api
          image: orders-api:local
          ports: [{ containerPort: 8080 }]
          env: [{ name: PORT, value: "8080" }]
          readinessProbe: { httpGet: { path: /healthz, port: 8080 }, initialDelaySeconds: 3 }
---
apiVersion: v1
kind: Service
metadata:
  name: orders-api
spec:
  selector: { app: orders-api }
  ports: [{ port: 80, targetPort: 8080 }]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-sqs-worker
spec:
  replicas: 1
  selector: { matchLabels: { app: orders-sqs-worker } }
  template:
    metadata: { labels: { app: orders-sqs-worker } }
    spec:
      containers:
        - name: orders-sqs-worker
          image: orders-sqs-worker:local
          env: [{ name: QUEUE_URL, value: "https://sqs.eu-west-1.amazonaws.com/<account-id>/orders-in" }]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-kafka-worker
spec:
  replicas: 1
  selector: { matchLabels: { app: orders-kafka-worker } }
  template:
    metadata: { labels: { app: orders-kafka-worker } }
    spec:
      containers:
        - name: orders-kafka-worker
          image: orders-kafka-worker:local
          env: [{ name: KAFKA_BROKERS, value: "kafka-bootstrap.kafka.svc.cluster.local:9092" }]
```

```bash
kubectl apply -f k8s.yaml
kubectl get pods   # 4 pods: 2x orders-api, 1x orders-sqs-worker, 1x orders-kafka-worker
```

## 7. Watch the same handler run three ways

```bash
kubectl port-forward service/orders-api 8080:80 &
curl -XPOST localhost:8080/orders -H 'content-type: application/json' \
     -d '{"customerId":"c-1","sku":"widget","quantity":3}'
```

Send a message to the SQS queue or the Kafka topic directly (see [the runnable
example](../examples/k8s-orders) for exact commands against a local LocalStack/Kafka pair) and the
**same handler** runs, for a request that never touched HTTP — `kubectl logs
deploy/orders-sqs-worker` shows it. That's the proof: one handler, three independently deployed,
independently scaled entry points.

```bash
kubectl scale deploy/orders-kafka-worker --replicas=3   # only the Kafka leg scales
```

## Next steps

- **Why this shape at all** — [Why not just Express?](getting-started.md#why-not-just-express).
- **More self-hosted workers** — [Kafka Setup](getting-started-kafka.md) covers `useKafka` in depth;
  `@benzene/aws-sqs` is documented in its own package. Both are worth reaching for even as a
  service's *only* transport, since neither's raw client (kafkajs, aws-sdk) gives you routing or a
  middleware pipeline the way Express gives HTTP.
- **The cloud hosts** — [AWS Lambda](getting-started-aws.md) and
  [Azure Functions](getting-started-azure.md) run the same handler behind a managed event source
  instead of a self-hosted poller.

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
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { message, MessageHandlersRegistry } from '@benzenejs/core-message-handlers';
import { httpEndpoint } from '@benzenejs/http';
import { BenzeneResult } from '@benzenejs/results';

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

## 2. Declare all three transports in one startup

Hosting belongs in the startup, not the entry point. One `BenzeneStartUp` declares every transport as
a peer worker, all dispatching into the same handler:

```ts
// src/startUp.ts
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

export class OrdersStartUp implements BenzeneStartUp {
  getConfiguration(): BenzeneConfiguration {
    return { get: (key) => process.env[key] };
  }

  configureServices(_services: IBenzeneServiceContainer, _configuration: BenzeneConfiguration): void {}

  configure(app: IBenzeneApplicationBuilder, configuration: BenzeneConfiguration): void {
    const sqsClient = new SQSClient(); // default credential chain - an IRSA role on EKS
    const brokers = (configuration.get('KAFKA_BROKERS') ?? 'localhost:9092').split(',');

    useWorker(app, (workers) => {
      useExpress(workers, { port: Number(configuration.get('PORT') ?? 8080) }, (http) =>
        useMessageHandlers(http, PlaceOrderHandler),
      );

      useSqs(
        workers,
        { queueUrl: configuration.get('QUEUE_URL')!, maxNumberOfMessages: 10 },
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
```

`useExpress` here means **Benzene owns the HTTP listener** — HTTP is one worker among three, and a
request no handler owns gets a 404. That is a different rung from `benzene(...)`, which returns
ordinary Express middleware for when the process is *your* Express app and Benzene handles some of its
routes; see [Getting Started](getting-started.md).

Then the entry point, in full:

```ts
// src/app.ts
import { BenzeneHost } from '@benzenejs/self-host';
import { OrdersStartUp } from './startUp.js';

await BenzeneHost.runAsync(OrdersStartUp);
```

`BenzeneHost.runAsync` starts every worker, waits for `SIGINT`/`SIGTERM` — the signal Kubernetes sends
before the termination grace period — then stops them and drains. Adding a fourth transport never
touches this file, which is the whole reason hosting lives in the startup.

### Dropping a level

`runAsync` is composed from two public steps, and you can stop at either:

```ts
// Build the worker without running it - the seam a test uses, and where you resolve services
// from the container the startup registered.
const worker = BenzeneHost.build(OrdersStartUp);

// ...then run it on your own terms, with the signal handling still done for you:
await BenzeneHost.runWorkerAsync(worker, { signal: myController.signal });

// ...or fully by hand, no host at all:
await worker.startAsync(myController.signal);
await worker.stopAsync();
```

And `build` itself is only this, all public API — write it out whenever you need something in the
middle:

```ts
const startUp = new OrdersStartUp();
const configuration = startUp.getConfiguration?.() ?? emptyConfiguration();
const container = new DefaultBenzeneServiceContainer();   // @benzenejs/dependencies
startUp.configureServices(container, configuration);
const builder = new WorkerApplicationBuilder(container);  // @benzenejs/self-host
startUp.configure(builder, configuration);
const worker = builder.createWorker(
  withStartUpChecks(container.createServiceResolverFactory()), // @benzenejs/core-message-handlers
);
```

`withStartUpChecks` is the reason a wiring mistake — two handlers on one topic, a transport pointed at
nothing — fails the process at start-up with a message naming the fix, rather than on the first
message that reaches the broken link. `BenzeneHost.build` runs it for you.

A note on why this used to be harder: a polling worker's `startAsync` *is* its loop and does not
resolve until the worker is stopped, while a push-based one (kafkajs, an HTTP listener) resolves as
soon as it is subscribed or bound. Hand-rolling the entry point means getting that difference right —
`await`ing a polling worker inline starves everything after it. `BenzeneHost` waits on the shutdown
signal rather than on the workers, so the distinction stops being yours to get right.

## 3. Containerise it

One process, one `Dockerfile`, one image. Because `@benzenejs/*` packages are resolved as npm
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
          # Benzene owns the HTTP listener (useExpress), so every route is a message handler; a TCP
          # probe checks the listener without inventing a non-domain HTTP route. For an HTTP readiness
          # surface at /benzene/health, wire useBenzeneCloudService (@benzenejs/cloud-service).
          readinessProbe: { tcpSocket: { port: 8080 }, initialDelaySeconds: 3 }
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
cheap to, and because one startup declaring three workers is no more code than one declaring one. It
is not the *only* shape, though, and it is not always the right one. Splitting the
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
  `@benzenejs/aws-sqs` is documented in its own package. Both are worth reaching for even as a
  service's *only* transport, since neither's raw client (kafkajs, aws-sdk) gives you routing or a
  middleware pipeline the way Express gives HTTP.
- **The cloud hosts** — [AWS Lambda](getting-started-aws.md) and
  [Azure Functions](getting-started-azure.md) run the same handler behind a managed event source
  instead of a self-hosted poller.

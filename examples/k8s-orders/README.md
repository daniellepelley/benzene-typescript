# One handler, one process, three transports

The runnable version of [Getting Started: Benzene on Kubernetes](../../docs/getting-started-kubernetes.md).

The same `PlaceOrderHandler` — `src/domain.ts`, imported by every file below — reached three
independent ways, from **one** running process:

```
        HTTP        ─────────┐
        SQS queue   ─────────┼──▶  orders-app (Deployment)  ──▶  PlaceOrderHandler
        Kafka topic ─────────┘        (src/startUp.ts)            (src/domain.ts)
```

Nothing in the handler knows which transport called it. That's the point: `src/startUp.ts` declares the
HTTP listener, the SQS poller, and the Kafka consumer as three peer workers in the same Node process,
all dispatching into the exact same handler class — a bare Express route alone gives you the HTTP leg;
Benzene gives you all three from one class, one image, one Deployment.

The entry point is one line — `await BenzeneHost.runAsync(OrdersStartUp)` — because starting, signal
handling, and graceful shutdown are the framework's job, not the service's.

## Files

This is one npm package (`@benzene-example/k8s-orders`) with one entry point sharing one domain file:

| Path | What it is |
|---|---|
| `src/domain.ts` | the shared handler - `PlaceOrderHandler`, decorated with both `@httpEndpoint('POST', '/orders')` and `@message('order-place')` |
| `src/startUp.ts` | the whole service - all three transports declared as peer workers in one `useWorker(...)` block: `useExpress` (`@benzenejs/express`), `useSqs` (`@benzenejs/aws-sqs`'s self-hosted poller, not the Lambda-trigger `@benzenejs/aws-lambda-sqs`) and `useKafka` (`@benzenejs/kafka-core`) |
| `src/app.ts` | the entry point, in full: `await BenzeneHost.runAsync(OrdersStartUp)` - starting, signal handling and graceful shutdown are the framework's job, and adding a fourth transport does not touch this file |
| `k8s/` | one Deployment + Service, pointed at a real SQS queue and Kafka cluster via env vars - no bundled infra |
| `compose/` | `docker-compose.yml` - LocalStack (SQS) + a throwaway Kafka broker + the one service, for a credential-free local run |

Every leg wires the handler itself (`useMessageHandlers(pipeline, PlaceOrderHandler)`) — this port has
no reflection-based handler discovery, so "shared" means "the same class imported once, wired three
times," not "auto-discovered."

## Run it locally (no Kubernetes, no cloud account)

```bash
docker compose -f examples/k8s-orders/compose/docker-compose.yml up --build
```

Then, in three more terminals:

```bash
# 1. HTTP
curl -XPOST localhost:8080/orders -H 'content-type: application/json' \
     -d '{"customerId":"c-1","sku":"widget","quantity":3}'
# {"orderId":"order-...","status":"placed"}

# 2. SQS - send straight to the queue LocalStack created, no HTTP involved. `run --rm --entrypoint aws`
# starts a fresh throwaway container on the sqs-init service's image/network/credentials (that
# service's own container already exited once it finished creating the queue).
docker compose -f examples/k8s-orders/compose/docker-compose.yml run --rm --entrypoint aws sqs-init \
  --endpoint-url=http://localstack:4566 sqs send-message \
    --queue-url http://localstack:4566/000000000000/orders-in \
    --message-body '{"customerId":"c-2","sku":"gadget","quantity":1}' \
    --message-attributes 'topic={StringValue=order-place,DataType=String}'

# 3. Kafka - produce straight to the topic, no HTTP involved (the Benzene topic IS the literal Kafka
# topic name here, unlike SQS/HTTP's attribute/route - see src/domain.ts's comment).
docker exec -i $(docker compose -f examples/k8s-orders/compose/docker-compose.yml ps -q kafka) \
  kafka-console-producer --bootstrap-server localhost:29092 --topic order-place <<< \
  '{"customerId":"c-3","sku":"gizmo","quantity":2}'
```

Three different entry points, one container's logs — `docker compose logs -f orders-app` — proving
all three ran through the exact same handler code.

## Deploy to Kubernetes

Build and load the one image (against a [kind](https://kind.sigs.k8s.io) cluster — swap for your
registry's push/pull on a real cluster):

```bash
docker build -f examples/k8s-orders/Dockerfile -t k8s-orders:local .
kind load docker-image k8s-orders:local
```

Edit the placeholder `QUEUE_URL`/`KAFKA_BROKERS` values in `k8s/app.yaml` to point at a real queue and
cluster (there is deliberately no bundled SQS/Kafka in this manifest — see the file's own comment for
why, and for the IRSA note on the SQS side), then:

```bash
kubectl apply -k examples/k8s-orders/k8s/
kubectl -n k8s-orders get pods   # 2 pods: 2x orders-app
kubectl -n k8s-orders logs -f deploy/orders-app
```

There's only one Deployment to scale - scaling it scales all three transports' consuming capacity
together:

```bash
kubectl -n k8s-orders scale deploy/orders-app --replicas=4
```

## Why this, and not just Express

See [Why not just Express?](../../docs/getting-started.md#why-not-just-express) for the reasoning
this example exists to prove.

## The alternative: one Deployment per transport

Combining all three transports into one process is not the only valid shape - splitting them into
**separate** entry points/Deployments (one for HTTP, one for the SQS poller, one for the Kafka
consumer, each its own image) is a legitimate pattern too, and sometimes the better one: each
transport then scales, rolls back, and fails independently of the others. The tradeoff is real: more
images to build, more Deployments to manage, and a little duplicated startup wiring per transport if
they're split into separate scripts. Reach for that shape instead when the transports' traffic,
failure modes, or scaling needs genuinely diverge - `src/domain.ts` doesn't change either way, only
how many entry points and Dockerfiles wrap it.

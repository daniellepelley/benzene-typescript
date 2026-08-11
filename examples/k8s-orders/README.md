# One handler, three Kubernetes Deployments

The runnable version of [Getting Started: Benzene on Kubernetes](../../docs/getting-started-kubernetes.md).

The same `PlaceOrderHandler` — the shared handler every entry point below imports from `src/domain.ts`
— reached three independent ways, each its own pod:

```
                              ┌──────────────────────────────────────┐
        HTTP  ──────────────▶│  orders-api           (Deployment)    │──┐
                              └──────────────────────────────────────┘  │
                              ┌──────────────────────────────────────┐  │   all three dispatch
        SQS queue  ─────────▶│  orders-sqs-worker    (Deployment)    │──┼──▶ PlaceOrderHandler
                              └──────────────────────────────────────┘  │   (src/domain.ts)
                              ┌──────────────────────────────────────┐  │
        Kafka topic  ───────▶│  orders-kafka-worker  (Deployment)    │──┘
                              └──────────────────────────────────────┘
```

Nothing in the handler knows which pod called it. That's the point: the same business logic scales,
deploys, and rolls back independently behind whichever transport actually reaches it — a bare Express
route alone gives you the first Deployment; Benzene gives you all three from one handler class.

## Files

This is one npm package (`@benzene-example/k8s-orders`) with three entry point scripts sharing one
domain file — the simplest way to share a handler across sibling processes without splitting into
separate npm workspaces:

| Path | What it is |
|---|---|
| `src/domain.ts` | the shared handler - `PlaceOrderHandler`, decorated with both `@httpEndpoint('POST', '/orders')` and `@message('order-place')`, imported by all three entry points below |
| `src/httpApp.ts` / `src/api.ts` | an Express app (`@benzene/express`) - `POST /orders`, plus the runnable entry point |
| `src/sqsWorker.ts` | `@benzene/aws-sqs`'s `useSqs` - the self-hosted SQS poller, not the Lambda-trigger `@benzene/aws-lambda-sqs` |
| `src/kafkaWorker.ts` | `@benzene/kafka-core`'s `useKafka` - the self-hosted Kafka consumer |
| `k8s/` | three Deployments (`api.yaml` also a Service), pointed at a real SQS queue and Kafka cluster via env vars - no bundled infra |
| `compose/` | `docker-compose.yml` - LocalStack (SQS) + a throwaway Kafka broker + all three services, for a credential-free local run |

Every entry point wires the handler itself (`useMessageHandlers(pipeline, PlaceOrderHandler)`) — this
port has no reflection-based handler discovery, so "shared" means "the same class imported three times
and wired explicitly," not "auto-discovered." See each file's `build*` function.

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

`docker compose logs -f orders-api orders-sqs-worker orders-kafka-worker` to watch all three at once —
an order placed through any of the three reaches the exact same handler.

## Deploy to Kubernetes

Build and load the three images (against a [kind](https://kind.sigs.k8s.io) cluster — swap for your
registry's push/pull on a real cluster):

```bash
docker build -f examples/k8s-orders/Dockerfile.api        -t k8s-orders-api:local        .
docker build -f examples/k8s-orders/Dockerfile.sqsWorker   -t k8s-orders-sqs-worker:local   .
docker build -f examples/k8s-orders/Dockerfile.kafkaWorker -t k8s-orders-kafka-worker:local .
kind load docker-image k8s-orders-api:local k8s-orders-sqs-worker:local k8s-orders-kafka-worker:local
```

Edit the placeholder env values in `k8s/sqs-worker.yaml` and `k8s/kafka-worker.yaml` to point at a
real queue and cluster (there is deliberately no bundled SQS/Kafka in these manifests — see each
file's own comment for why, and for the IRSA note on the SQS side), then:

```bash
kubectl apply -k examples/k8s-orders/k8s/
kubectl -n k8s-orders get pods   # 4 pods: 2x orders-api, 1x orders-sqs-worker, 1x orders-kafka-worker
kubectl -n k8s-orders logs -f deploy/orders-sqs-worker
```

Scale the transports independently, because they're independent Deployments:

```bash
kubectl -n k8s-orders scale deploy/orders-kafka-worker --replicas=3
```

## Why this, and not just Express

See [Why not just Express?](../../docs/getting-started.md#why-not-just-express) for the reasoning
this example exists to prove.

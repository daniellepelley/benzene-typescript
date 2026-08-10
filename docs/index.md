# Benzene (TypeScript)

Benzene is a hexagonal framework for services running in serverless environments, containers, or on
physical servers. It supports multiple cloud providers and provides a unified programming model for
message-based architectures. This is the **TypeScript port** of
[Benzene](https://github.com/daniellepelley/benzene) — you write a message handler once and host it
unchanged on Express, AWS Lambda, or Azure Functions.

> **Documentation in progress.** This is the growing TypeScript documentation set, ported from the .NET
> docs. The guides below and the full [cookbook collection](cookbooks/README.md) are complete; a few areas
> (the service mesh UI and usage feed) are still being ported. For the complete API surface today, see the
> [repository README](https://github.com/daniellepelley/benzene-typescript#readme), and for runnable
> projects covering every transport, the
> [`examples/`](https://github.com/daniellepelley/benzene-typescript/tree/main/examples) folder.

### Main Themes

- **General**
  - [Getting Started](getting-started.md) — build and run your first Benzene service in about five minutes
    - [AWS Lambda](getting-started-aws.md) — one function over API Gateway, SQS, SNS, EventBridge, and Kafka
    - [Azure Functions](getting-started-azure.md) — HTTP, Service Bus, and Event Hub triggers
    - [Google Cloud Functions](getting-started-google.md) — HTTP + Pub/Sub
    - [gRPC](getting-started-grpc.md) — expose handlers over a gRPC server and call other services
    - [Kafka](getting-started-kafka.md) — run your handlers as a self-hosted Kafka consumer-group worker
  - [Unified Hosting Model](hosting.md) — the same handler on Express, AWS Lambda, Azure Functions, or a
    self-hosted worker
  - [Message Handlers](message-handlers.md) — the components that process a message, and how they're
    discovered and routed
  - [Message Results](message-result.md) — `IBenzeneResultOf<T>`, the `BenzeneResult` factory, and how
    statuses map onto each transport
  - [Middleware](middleware.md) — the pipeline mechanism every request flows through
  - [Common Middleware](common-middleware.md) — the ready-made middleware Benzene ships
  - [Correlation IDs](correlation-ids.md) — trace a request end-to-end across services
  - [Monitoring & Diagnostics](monitoring.md) — tracing, metrics, and logging via OpenTelemetry
  - [Sampling Strategies](sampling-strategies.md) — control how much tracing you keep in production
  - [Diagnosing Failures](diagnosing-failures.md) — a message failed in production; find out why across
    results, logs, traces, and metrics
  - [Health Checks](health-checks.md) — liveness/readiness checks and the built-in disk/HTTP/TCP/database
    checks
  - [Kubernetes Health Checks](kubernetes-health-checks.md) — wiring liveness/readiness probes for K8s
  - [Testing Benzene](testing-benzene.md) — test handlers in isolation and drive whole transport pipelines
    in-memory with vitest
  - [Payload Testing](payload-testing.md) — build demo payloads and send them into a service by topic

- **Cloud Providers**
  - **AWS**
    - [AWS Lambda Setup](getting-started-aws.md) — API Gateway, SQS, SNS, EventBridge, and Kafka, plus the
      one-function-per-transport vs composite deployment models
  - **Azure**
    - [Azure Functions — getting started](getting-started-azure.md) — one set of handlers over HTTP, Service
      Bus, and Event Hub triggers
    - [Azure Functions Setup](azure-functions.md) — the Azure Functions v4 model over HTTP, Service Bus, and
      Event Hub
  - **Google Cloud**
    - [Google Cloud Functions — getting started](getting-started-google.md) — one set of handlers over HTTP +
      Pub/Sub

- **Messaging**
  - [Getting started with gRPC](getting-started-grpc.md) — expose handlers over a gRPC server and call other
    services with the gRPC client binding
  - [Getting started with Kafka](getting-started-kafka.md) — run your handlers as a self-hosted Kafka
    consumer-group worker

- **Integrations**
  - [Validation](validation.md) — reject bad requests before they reach your handler, via the Zod, Joi,
    Yup, and JSON Schema (ajv) adapters
  - [Serialization & Media Formats](serialization.md) — JSON by default, plus the XML, MessagePack, and Avro
    adapters
  - [Schema Registry](schema-registry.md) — register and evolve message schemas across services
  - [Rate Limiting](rate-limiting.md) — fixed-window, token-bucket, and payload-size limiting

- **Clients & Resilience**
  - [Clients](clients.md) — call other Benzene services with outbound routing, retries, and parallel fan-out
  - [Caching](caching.md) — the cache abstraction and the Redis-backed adapter
  - [Resilience](resilience.md) — retry-with-backoff around a pipeline stage

- **Cookbooks**
  - [Cookbooks](cookbooks/README.md) — practical recipes for real-world scenarios

### About the port

Benzene TypeScript mirrors the .NET library's structure, names, and file layout as closely as the language
allows; ported tests come from the C# suite. Where the two necessarily differ — free functions instead of
extension methods, `Promise` instead of `Task`, decorators instead of attributes, Zod/Joi/Yup instead of
FluentValidation/DataAnnotations — the reasons are recorded in the README's
[Porting conventions](https://github.com/daniellepelley/benzene-typescript#porting-conventions). Every doc
here uses the real, current TypeScript API; when in doubt, the `src/` in the repository is the source of
truth.

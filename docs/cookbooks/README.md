# Benzene Cookbooks

Practical recipes for common real-world scenarios using the TypeScript port of Benzene.

## What are cookbooks?

Cookbooks are step-by-step guides that show you how to solve a specific problem with Benzene. Each one
focuses on a single use case and gives you complete, copy-pasteable TypeScript you can adapt to your own
service — the same three-level documentation set the .NET original ships, ported to npm, ESM, and vitest.

If you're new to Benzene, start with [Getting Started](../getting-started.md) and the
[docs index](../index.md) first; the cookbooks assume you already have a handler and a host wired up.

## Available cookbooks

### AWS

- [Handling SQS Message Failures](handling-sqs-failures.md) — report only the messages that actually
  failed back to SQS for redelivery, retry transient errors in-process, and let permanent failures fall
  through to a dead-letter queue.
- [SNS Fan-Out Pattern](sns-fan-out.md) — publish one event to an SNS topic and have several
  independently-deployed Lambda functions each process their own copy of it.
- [S3 Event Processing](s3-event-processing.md) — trigger a Lambda when an object is uploaded to an S3
  bucket, route the record to a handler by its S3 event name, and read (or fetch) the object to process it.
- [HTTP Front + SQS/SNS Back](express-with-sqs-and-sns.md) — an Express HTTP endpoint that publishes to
  SNS, with a separate self-hosted SQS worker consuming the fan-out — the two-deployable TS shape.
- [Lambda Cold-Start Optimization](lambda-cold-start-optimization.md) — build the pipeline once at module
  load, keep connections warm, tree-shake with esbuild, and use provisioned concurrency.
- [Deploy with the Serverless Framework](deploy-with-serverless-framework.md) — a `serverless.yml` + esbuild
  recipe for shipping a Benzene Lambda, including one function fronting several event sources.

### Reliability & Workflow

- [Idempotency](idempotency.md) — make a handler safe to invoke more than once, so an at-least-once
  transport (SQS, SNS, retries) can't apply the same effect twice.
- [Sagas](sagas.md) — coordinate a multi-step workflow across services with compensating rollback when a
  later step fails.
- [Global Error Handling](global-error-handling.md) — catch any thrown error at the pipeline edge, log it,
  and map it to a safe error result without leaking internals.
- [Resilience with Cockatiel](cockatiel-resilience.md) — wrap handlers and outbound calls in retry, timeout,
  and circuit-breaker policies via `@benzenejs/cockatiel` (the Polly analog).
- [Transactional Outbox](transactional-outbox.md) — persist the outgoing event in the same transaction as
  the state change, then relay it reliably through an outbound client.
- [Per-Request Unit of Work](unit-of-work.md) — commit a scoped unit of work when the pipeline succeeds
  and roll it back when it fails, transport-independently, via `unitOfWorkMiddleware`.

### Messaging & Integration

- [Response as Event](response-as-event.md) — publish a domain event derived from a handler's result,
  either by explicit mapping or the CRUD naming convention.
- [Message Versioning](message-versioning.md) — evolve a payload's schema across versions, dispatching by
  the `benzene-version` header and up-casting older payloads with `@benzenejs/core-versioning`.
- [Schema Registry](schema-registry.md) — serialize with a Confluent-style schema registry, enforce
  compatibility, and evolve schemas safely with `@benzenejs/schema-registry-core` and `@benzenejs/avro`.
- [Multi-Tenancy](multi-tenancy.md) — resolve the tenant from the message into per-request scope and
  resolve tenant-scoped dependencies.

### Azure

- [Service Bus Handling](service-bus-handling.md) — consume Azure Service Bus on both the Functions trigger
  and a self-hosted worker, with the port's settlement/ack model.
- [Event Hub Processing](event-hub-processing.md) — process Event Hub batches on the Functions trigger and
  the self-hosted worker, with checkpointing.
- [Cosmos DB Change Feed](cosmos-change-feed-processing.md) — react to Cosmos DB document changes via the
  self-hosted change-feed processor and the Functions trigger.

### Observability

- [Distributed Tracing with OpenTelemetry](distributed-tracing-opentelemetry.md) — emit a span per
  middleware, propagate W3C trace context across services, and export to an OTel collector.
- [Custom Metrics with OpenTelemetry](custom-metrics-opentelemetry.md) — record Benzene's built-in
  instruments plus your own business metrics through an OTel MeterProvider.
- [Request Correlation](request-correlation.md) — track a correlation id across a request and propagate it
  to downstream calls via `ICorrelationId` and the outbound clients.
- [Structured Logging with pino](structured-logging-pino.md) — implement the port's `ILogger` over pino,
  enrich logs with the correlation id, and register it in DI (the Serilog analog).

### Validation & Security

- [Custom Validation Rules with Zod](zod-custom-rules.md) — express custom and cross-field rules with zod's
  `.refine`/`.superRefine` and map failures to Benzene results.
- [Auth Patterns](auth-patterns.md) — establish authentication (Basic, OAuth2/bearer) and authorize
  per-handler with `requireRole`/`requireScope`/`requirePolicy`.
- [Secrets & Configuration](secrets-configuration.md) — resolve secrets through composable stores (env var,
  file, in-memory, cached), and adapt a cloud secret manager against the `ISecretStore` seam.

### Architecture & Testing

- [Bring Your Own DI Container](bring-your-own-di-container.md) — the default container, the `static inject`
  convention, and adapting an external container against Benzene's DI contracts.
- [TypeORM Integration](typeorm-integration.md) — inject a TypeORM `DataSource` and repository into a handler
  and wire the database health check (the Entity Framework analog).
- [Redis Caching](redis-caching.md) — cache with `@benzenejs/cache-redis` (ioredis), using lazy-load,
  write-through, and invalidation patterns, with a cache health check.
- [Mocking External Dependencies](mocking-dependencies.md) — test a handler in isolation by swapping its
  real dependencies (databases, HTTP clients, cloud SDKs) for fakes registered in the container, while
  still running the message through the real pipeline.
- [Testing Lambda Functions](testing-lambda-functions.md) — boot the real StartUp and drive each AWS trigger
  through the front door with `benzeneTestHost`, asserting on responses and published messages.
- [Contract Testing](contract-testing.md) — verify a service still satisfies its consumers' contracts using
  the `/benzene/spec` profile, `CloudServiceProbe`, and contract health checks.

## Cookbook structure

Each cookbook follows the same shape:

1. **Problem Statement** — what you're trying to achieve.
2. **Prerequisites / Installation** — what you need, and the `npm install @benzenejs/…` packages.
3. **Step-by-Step Implementation** — a detailed walkthrough with complete, runnable code.
4. **Testing** — how to verify it with vitest.
5. **Troubleshooting** — common issues and fixes.
6. **Variations** — alternative approaches or extensions.
7. **Further Reading** — related docs and resources.

## See also

- [Documentation index](../index.md) — the full docs tree.
- [Getting Started](../getting-started.md) — from an empty folder to a running service.
- [AWS Lambda Setup](../getting-started-aws.md) — hosting the same handler on Lambda.
- [Testing Benzene](../testing-benzene.md) — the complete testing guide.

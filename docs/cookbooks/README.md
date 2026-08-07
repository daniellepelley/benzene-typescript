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

### Reliability & Workflow

- [Idempotency](idempotency.md) — make a handler safe to invoke more than once, so an at-least-once
  transport (SQS, SNS, retries) can't apply the same effect twice.
- [Sagas](sagas.md) — coordinate a multi-step workflow across services with compensating rollback when a
  later step fails.
- [Global Error Handling](global-error-handling.md) — catch any thrown error at the pipeline edge, log it,
  and map it to a safe error result without leaking internals.

### Messaging & Integration

- [Response as Event](response-as-event.md) — publish a domain event derived from a handler's result,
  either by explicit mapping or the CRUD naming convention.

### Security

- [Auth Patterns](auth-patterns.md) — establish authentication (Basic, OAuth2/bearer) and authorize
  per-handler with `requireRole`/`requireScope`/`requirePolicy`.

### Architecture & Testing

- [Secrets & Configuration](secrets-configuration.md) — resolve secrets through composable stores (env var,
  file, in-memory, cached), and adapt a cloud secret manager against the `ISecretStore` seam.
- [Bring Your Own DI Container](bring-your-own-di-container.md) — the default container, the `static inject`
  convention, and adapting an external container against Benzene's DI contracts.
- [Mocking External Dependencies](mocking-dependencies.md) — test a handler in isolation by swapping its
  real dependencies (databases, HTTP clients, cloud SDKs) for fakes registered in the container, while
  still running the message through the real pipeline.
- [Per-Request Unit of Work](unit-of-work.md) — commit a scoped unit of work when the pipeline succeeds
  and roll it back when it fails, transport-independently, via `unitOfWorkMiddleware`.

## Cookbook structure

Each cookbook follows the same shape:

1. **Problem Statement** — what you're trying to achieve.
2. **Prerequisites / Installation** — what you need, and the `npm install @benzene/…` packages.
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

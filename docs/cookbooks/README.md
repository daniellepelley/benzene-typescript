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
- S3 Event Processing *(coming soon)*
- Deploying a Benzene Lambda *(coming soon)*

### Testing

- [Mocking External Dependencies](mocking-dependencies.md) — test a handler in isolation by swapping its
  real dependencies (databases, HTTP clients, cloud SDKs) for fakes registered in the container, while
  still running the message through the real pipeline.
- Integration Testing Lambda Functions *(coming soon)*

### Validation & Error Handling

- Global Error Handling *(coming soon)*
- Request/Response Transformations *(coming soon)*

### Cross-Cutting Concerns

- Request Correlation Across Services *(coming soon)*
- Idempotency *(coming soon)*

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

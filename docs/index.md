# Benzene (TypeScript)

Benzene is a hexagonal framework for services running in serverless environments, containers, or on
physical servers. It supports multiple cloud providers and provides a unified programming model for
message-based architectures. This is the **TypeScript port** of
[Benzene](https://github.com/daniellepelley/benzene-dotnet) — you write a message handler once and host it
unchanged on Express, AWS Lambda, or Azure Functions.

> **Documentation in progress.** This is the initial TypeScript documentation set, ported from the .NET
> docs. The core guides below are complete; more (unified hosting, clients, caching, resilience, health
> checks, the service mesh, and the full cookbook collection) are being ported. For the complete API
> surface today, see the [repository README](https://github.com/daniellepelley/benzene-typescript#readme),
> and for runnable projects covering every transport, the
> [`examples/`](https://github.com/daniellepelley/benzene-typescript/tree/main/examples) folder.

### Main Themes

- **General**
  - [Getting Started](getting-started.md) — build and run your first Benzene service in about five minutes
  - [Message Handlers](message-handlers.md) — the components that process a message, and how they're
    discovered and routed
  - [Message Results](message-result.md) — `IBenzeneResultOf<T>`, the `BenzeneResult` factory, and how
    statuses map onto each transport
  - [Middleware](middleware.md) — the pipeline mechanism every request flows through
  - [Common Middleware](common-middleware.md) — the ready-made middleware Benzene ships
  - [Correlation IDs](correlation-ids.md) — trace a request end-to-end across services
  - [Testing Benzene](testing-benzene.md) — test handlers in isolation and drive whole transport pipelines
    in-memory with vitest

- **Cloud Providers**
  - **AWS**
    - [AWS Lambda Setup](getting-started-aws.md) — API Gateway, SQS, SNS, EventBridge, and Kafka, plus the
      one-function-per-transport vs composite deployment models
  - **Azure**
    - [Azure Functions Setup](azure-functions.md) — the Azure Functions v4 model over HTTP, Service Bus, and
      Event Hub

- **Integrations**
  - [Validation](validation.md) — reject bad requests before they reach your handler, via the Zod, Joi, and
    Yup adapters

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

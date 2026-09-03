# Capability Matrix — what this port does, deliberately doesn't, and how to fill the gap

Benzene is honest about its boundaries. This page is the single place that states, for the
TypeScript port, **what is provided** (with the package that provides it), **what is deliberately
not done and why**, and **how to solve the rest outside Benzene**. Nothing here is a hidden gap —
a deliberate "no" is a design decision stated with its reasoning; a plain "not implemented" is an
honest omission, and the two are never conflated. Where this port does less than the .NET
original, the row says so.

## The one idea behind every row

Benzene abstracts at the **business-logic boundary** — you write a message handler once and host
it anywhere — and **never at the transport or storage boundary**. Wrapping SQS or Service Bus
behind a generic "queue" interface would hide the transport-specific capabilities that were the
reason to choose it. So the answer to "does it abstract X?" is usually a deliberate **no**: you
keep full, direct access to the underlying SDK, and when Benzene doesn't ship an adapter,
**rolling your own is a first-class, supported path** — a small middleware or custom pipe, not an
escape hatch. See [Middleware](middleware.md) and [Common Middleware](common-middleware.md).

Two corollaries you'll see below:

- **A database is not a transport.** Benzene delivers events *in*; persisting state is your
  handler's own code (TypeORM, Prisma, the AWS/Azure SDKs, …).
- **Some problems can't be solved at runtime inside Benzene at all.** Independent processes
  (separate Lambda invocations, separate containers) can't coordinate without external shared
  state with atomic semantics. Benzene won't pretend otherwise.

## Packages and areas

| Area | What this port provides | What it deliberately does NOT do (and why) | How to solve the rest |
|---|---|---|---|
| **Core pipeline** | Middleware pipeline, `@message` handler routing, `BenzeneResult` statuses, DI container seam (`src/Benzene.Core*`, `src/Benzene.Abstractions*`, `src/Benzene.Results`) | Lock you into its built-in container — the resolver is a seam | [Bring your own DI container](cookbooks/bring-your-own-di-container.md); concepts and wire contracts are in the cross-language [spec](https://github.com/daniellepelley/Benzene/tree/main/docs/specification) |
| **HTTP hosting** | Transport-agnostic HTTP core (`src/Benzene.Http`) hosted on Express (`src/Benzene.Express`), AWS API Gateway (`src/Benzene.Aws.Lambda.ApiGateway`), Azure Functions HTTP (`src/Benzene.Azure.Function.Http`), Google Cloud Functions HTTP (`src/Benzene.GoogleCloud.Functions.Http`) | Ship its own HTTP server — it adapts the host you chose (Express, the platform runtime) | [Getting Started](getting-started.md), [Hosting](hosting.md) |
| **gRPC** | Server binding with method discovery, status mapping, streaming (`src/Benzene.Grpc`) + client binding (`src/Benzene.Grpc.Client`) + test helpers | Hide `@grpc/grpc-js` — the native call is on the context | [Getting started with gRPC](getting-started-grpc.md) |
| **Kafka** | Self-hosted consumer-group worker with health check (`src/Benzene.Kafka.Core`), AWS Lambda MSK trigger (`src/Benzene.Aws.Lambda.Kafka`), Azure Functions Kafka trigger (`src/Benzene.Azure.Function.Kafka`) | At-least-once by default on the self-hosted worker is deliberately NOT the default — a stream has no per-message ack, so `commitOnlyOnSuccess` defaults `false` (skip-and-continue, at-most-once); halting on every poison record is too drastic a default | `commitOnlyOnSuccess: true` for at-least-once; see [Getting started with Kafka](getting-started-kafka.md) and the settlement row below |
| **RabbitMQ** | Self-hosted worker with `Explicit`/`AutoAck` settlement (default `Explicit` — safe), requeue-on-failure, health check, test helpers (`src/Benzene.RabbitMq`, `src/Benzene.RabbitMq.TestHelpers`) | — | No dedicated doc page yet (an omission, not a decision) — mentions in [Hosting](hosting.md) and [Health Checks](health-checks.md); the package source and its `index.ts` are the current reference |
| **AWS** | Lambda adapters: API Gateway, SQS, SNS, EventBridge, DynamoDB Streams, Kinesis, S3, Kafka/MSK, X-Ray (`src/Benzene.Aws.Lambda.*`); self-hosted SQS consumer (`src/Benzene.Aws.Sqs`); outbound clients for SQS/SNS/EventBridge/Lambda/Step Functions (`src/Benzene.Clients.Aws.*`); test helpers | Wrap the AWS SDK — the native Lambda event/record is on every context | [Getting started on AWS](getting-started-aws.md); SDK calls live in your handler |
| **Azure** | Functions triggers: HTTP, Service Bus, Event Hub, Event Grid, Queue Storage, Blob Storage, Cosmos DB change feed, Kafka, Timer (`src/Benzene.Azure.Function.*`); self-hosted Service Bus and Event Hub workers (`src/Benzene.Azure.ServiceBus`, `src/Benzene.Azure.EventHub`); Cosmos DB change-feed processing (`src/Benzene.Azure.CosmosDb`); outbound clients (`src/Benzene.Clients.Azure.*`) | Same — the native trigger payload is on the context | [Getting started on Azure](getting-started-azure.md), [Azure Functions Setup](azure-functions.md) |
| **Google Cloud** | Cloud Functions HTTP + Pub/Sub adapters with test helpers (`src/Benzene.GoogleCloud.Functions.*`); Pub/Sub outbound client (`src/Benzene.Clients.GoogleCloud.PubSub`) | — | [Getting started on Google Cloud](getting-started-google.md) |
| **Mesh — service side** | Mesh wire shapes, descriptor factory, schema provider (`src/Benzene.Mesh.Wire`, `src/Benzene.Mesh.Contracts`, `src/Benzene.Mesh.Dispatch`), announcement from the service (`MeshAnnouncer` in `src/Benzene.CloudService`), per-platform sources (`src/Benzene.Mesh.Aws.Lambda`) | — | The mesh contracts are normative in the [spec](https://github.com/daniellepelley/Benzene/tree/main/docs/specification) |
| **Mesh — collector, fleet & UI** | Collector + read models (`src/Benzene.Mesh.Collector`, `src/Benzene.Mesh.Aggregator`, `src/Benzene.Mesh.Reporting`); discovery for AWS/Azure/Kubernetes (`src/Benzene.Mesh.Discovery.*`); fleet tracing sources for X-Ray/Jaeger/Tempo (`src/Benzene.Mesh.Fleet.*`, `src/Benzene.Mesh.Tracing.Tempo`); usage feeds for CloudWatch/Application Insights (`src/Benzene.Mesh.Usage.*`); storage on S3/Blob/GCS (`src/Benzene.Mesh.{Aws.S3,Azure.Blob,GoogleCloud.Storage}`); served UI (`src/Benzene.Mesh.Ui`) | — | Doc pages for the mesh UI and usage feed are still being ported (an omission, not a decision) — the runnable [`examples/mesh-service`](https://github.com/daniellepelley/benzene-typescript/tree/main/examples/mesh-service) is the current reference |
| **Health checks** | Builder + processor core (`src/Benzene.HealthChecks`, `src/Benzene.HealthChecks.Core`); disk/HTTP/TCP/DynamoDB/TypeORM/schema/Service Bus checks (`src/Benzene.HealthChecks.*`); transport-embedded checks (Kafka, RabbitMQ); external probe (`src/Benzene.CloudService.Probe`); client-side checks (`src/Benzene.Clients.HealthChecks`) | Ship a check for every dependency — the check interface is the seam | [Health Checks](health-checks.md), [Kubernetes Health Checks](kubernetes-health-checks.md) |
| **Spec endpoint / Cloud Service Profile** | The profile report and reserved paths (`src/Benzene.CloudService`), plus a served spec UI (`src/Benzene.Spec.Ui`) | — | Profile shape is normative in the [spec](https://github.com/daniellepelley/Benzene/tree/main/docs/specification) |
| **Codegen & clients** | Typed client generation from a committed contract document (`src/Benzene.CodeGen.Client`, with a CLI); outbound routing, retries, fan-out (`src/Benzene.Clients`); in-process transport for the modular monolith (`src/Benzene.Clients.InProcess`) | Require another language's SDK to call a Benzene service — the contract document is enough | [Clients](clients.md), [Generating a client from a Contract Document](codegen-contract-document.md) |
| **Caching** | Cache abstraction (`src/Benzene.Cache.Core`) + Redis adapter (`src/Benzene.Cache.Redis`). Degrades safely by contract: a cache read error is a miss, a cache write error after a successful load is logged and ignored (never fails the operation), a load error is returned and not cached, and an absent entry (`undefined`/`null`) is the only miss marker — a stored empty string is a valid cached value, and an intentionally-cached `null` is a real hit (negative caching). Prefix invalidation refuses an empty/whitespace prefix (and any effectively-universal pattern) instead of silently building `"*"` and wiping the cache — `createWildcardActions` with a real pattern is the explicit route | Grow into a general state-store abstraction (a database is not a transport) | [Caching](caching.md), [Redis caching](cookbooks/redis-caching.md) |
| **Validation** | Adapters for Zod, Joi, Yup, and JSON Schema via ajv (`src/Benzene.Zod`, `src/Benzene.Joi`, `src/Benzene.Yup`, `src/Benzene.Ajv`) over a shared validation abstraction (`src/Benzene.Abstractions.Validation`) | Port the .NET validation libraries — third-party integrations are re-created against the popular JS-ecosystem equivalents, by convention | [Validation](validation.md); one small adapter package per library is the pattern to copy for others |
| **Serialization** | JSON by default; XML, MessagePack, and Avro adapters (`src/Benzene.Xml`, `src/Benzene.MessagePack`, `src/Benzene.Avro`) | — | [Serialization & Media Formats](serialization.md) |
| **Versioning** | Payload version casting for requests, responses, and schemas (`src/Benzene.Core.Versioning`) | — | [Message versioning](cookbooks/message-versioning.md) |
| **AuthN / AuthZ** | OAuth2 bearer (JWT via `jose`) with a **required, no-default** signing-algorithm allowlist and scope claims (`src/Benzene.Auth.OAuth2`); Basic auth (`src/Benzene.Auth.Basic`); shared seams (`src/Benzene.Auth.Core`) | Ship a policy-engine (OPA/Cedar) adapter | Add an authorization middleware calling your policy engine on the `Benzene.Auth.Core` seams; see [Auth patterns](cookbooks/auth-patterns.md) |

## Cross-cutting production concerns

| Capability | What this port provides | What it deliberately does NOT do (and why) | How to solve the rest |
|---|---|---|---|
| **Transport features** | Full, direct access to the native SDK message/event on every adapter's context | Hide transport-specific capabilities behind a generic interface (the anti-pattern above) | Use the raw SDK feature directly — the context exposes the native message/event |
| **Message routing** | Topic-based dispatch to `@message` handlers (`src/Benzene.Core.MessageHandlers`); the same handler runs behind every transport | Impose a canonical envelope on transports that already carry routing (Kafka topic, Service Bus properties) | For envelope-less transports use the Benzene envelope or a preset topic; otherwise route on the native key. See [Message Handlers](message-handlers.md) |
| **Idempotency** | `IIdempotencyStore` seam + `InMemoryIdempotencyStore` (single-process) + atomic-claim middleware (`src/Benzene.Idempotency`). The store contract is **token-fenced**: a winning `tryClaimAsync` mints an opaque `claimToken`, and `completeAsync`/`releaseAsync` require it back, writing only if it still matches the live claim (a stale worker's late settle returns `false` and clobbers nothing; no token-less overload — a skippable fence is no fence). On a result-bearing context only an explicitly successful `messageResult` records completion; completing without setting one releases the claim for redelivery | Cross-instance de-duplication — independent processes can't coordinate at runtime without external state, and shared state can relocate the race, not remove it | An external store with an **atomic conditional write** (DynamoDB conditional put, Redis `SET NX`) keyed on message identity — settles fenced on the claim token (Redis Lua compare-and-write, DynamoDB `ConditionExpression`) — plus naturally idempotent handlers. See [Idempotency](cookbooks/idempotency.md) |
| **Outbox (produce-side atomicity)** | No package — nothing shipped. The `IResponseEventPublisher` seam (`src/Benzene.ResponseEvents`) and the scoped `IUnitOfWork` middleware (`src/Benzene.Core.Middleware`) are the documented drop-in points for your own | The port's docs state the position: "writing the outbox row inside *your* DB transaction is application territory" — a stated design decision here, **but an honest divergence from the .NET port**, which ships `Benzene.Outbox` (+ DynamoDB/EF store packages). This port has no equivalent; do not read this row as parity | The full DIY pattern — outbox publisher behind `IResponseEventPublisher`, one-transaction commit, a relay — is documented step by step in [Transactional Outbox](cookbooks/transactional-outbox.md). At-least-once delivery means consumers must dedup: pair it with [Idempotency](cookbooks/idempotency.md) |
| **Oversized payloads (claim check)** | **Not implemented.** No package, no doc page (the .NET port ships `Benzene.ClaimCheck` + S3/Blob stores; this port has no equivalent and no stated design reason — it is simply unbuilt) | — | Roll an offload/hydrate middleware pair over S3/Blob keyed by a header (the .NET `benzene-claim-check` contract is the shape to follow), or keep payloads under the transport limit |
| **Resilience** | `RetryMiddleware` — retry with exponential backoff (`src/Benzene.Resilience`); the full Cockatiel toolkit (circuit breaker, timeout, bulkhead, jittered backoff) via `src/Benzene.Cockatiel`, which bridges a returned failure result to Cockatiel's outcome model | Re-implement or hide Cockatiel — the adapter runs *your* policy, exposing its full surface. Note: `RetryMiddleware` has no jitter helper or max-delay cap (the .NET port has both; not implemented here) — use Cockatiel for jittered backoff | [Resilience](resilience.md), [Cockatiel resilience](cookbooks/cockatiel-resilience.md) |
| **Rate limiting** | Fixed-window, token-bucket, and concurrency limiters plus payload-size limiting middleware (`src/Benzene.RateLimiting`) | Distributed rate limiting — the same cross-instance-coordination constraint as idempotency | [Rate Limiting](rate-limiting.md); for a fleet-wide limit, back a custom limiter with shared atomic state (e.g. Redis) |
| **Sagas / workflows** | In-process, compensation-based saga with LIFO rollback and an `ISagaStateStore` for observability (`src/Benzene.Saga`) | Durable crash-resume — the saga is in-memory closures that can't be re-hydrated after a process dies; the state store records progress, it doesn't recover it | Use a durable orchestrator (Step Functions, Durable Functions, Temporal); `src/Benzene.Clients.Aws.StepFunctions` can *start* an execution from a handler. See [Sagas](cookbooks/sagas.md) |
| **Schema evolution** | Confluent wire-format codec + `ISchemaRegistryClient` seam (`src/Benzene.SchemaRegistry.Core`) | Structural backward-compatibility checking in-box — the shipped `TextualSchemaCompatibilityChecker` only accepts byte-identical schemas | Point at a real schema-registry server, or supply your own `ISchemaCompatibilityChecker`. See [Schema Registry](schema-registry.md) |
| **Database / state access** | *(nothing — by design)* | Any database abstraction — a database is not a transport, so wrapping one would hide its capabilities | Your handler uses its own SDK/ORM directly. See [TypeORM integration](cookbooks/typeorm-integration.md) and [Per-request transactions](cookbooks/unit-of-work.md) |
| **Configuration & secrets** | Provider-agnostic `ISecretStore` (env vars, files, in-memory, composed, cached) + fail-fast startup validation (`src/Benzene.Configuration.Core`) | Ship maintained cloud secret-store adapters (Key Vault / Secrets Manager / SSM) | Copy the small adapter from [Secrets & Configuration](cookbooks/secrets-configuration.md) and use the cloud SDK yourself |
| **Outbound HTTP** | `HttpClientMiddleware` over an injectable `fetch`-like function, defaulting to the Node global `fetch` (`src/Benzene.Clients.Http`) | Ship its own HTTP stack or manage connection pooling — you inject the `fetch` you want (undici agent, a test stub) | Pass your configured `fetch` in; correlation/trace propagation is applied on the Benzene-message outbound path. See [Clients](clients.md) |
| **Distributed tracing** | W3C `traceparent`/`tracestate` propagation (`W3CTraceContextMiddleware` in `src/Benzene.Clients`, extraction in `src/Benzene.Diagnostics`); OpenTelemetry via the standard API, exporter-agnostic | Ship a tracing backend or its sampling config — Benzene exports via the OTel API; Jaeger/Tempo/App Insights wiring is yours | [Monitoring & Diagnostics](monitoring.md), [Distributed tracing with OpenTelemetry](cookbooks/distributed-tracing-opentelemetry.md), [Sampling Strategies](sampling-strategies.md) |
| **Retry on a returned failure result** | Per-transport settlement, with knobs on some transports — see the [breakdown below](#returned-failure-result-settlement--the-per-transport-breakdown). Safe by default on SQS, DynamoDB Streams, Queue Storage, Event Grid, Pub/Sub, RabbitMQ, and the Service Bus worker | A single cross-transport reliability abstraction — retry semantics are transport-native. **The .NET 1.0 settlement contract ("every queue-shaped transport is safe by default") is not yet fully ported**: several TS adapters still default to accepting a returned failure result, or have no escalation knob at all. The breakdown below states each honestly | Know your transport's default from the table below; where a knob exists, opt in; where none exists, have the handler **throw** for anything that must be retried. Any retried handler must be idempotent. See [Message Results](message-result.md) and the failure-handling cookbooks |
| **Multi-tenancy** | *(nothing as a framework feature today)* | — | Roll a tenant-resolver middleware + a scoped tenant holder — the documented [Multi-Tenancy](cookbooks/multi-tenancy.md) pattern |

## Returned-failure-result settlement — the per-transport breakdown

"Failure result" means your handler returned `isSuccessful === false` — **not** a thrown
exception. Every adapter lets an unhandled exception propagate to the host's own retry machinery
by default; what varies is what happens to a *returned* failure result. The .NET port's 1.0
settlement contract made every queue-shaped transport safe by default; **this port has not fully
caught up**, and the differences below are stated plainly.

**Safe by default** (a returned failure result is redelivered, at-least-once):

| Transport | Verified default |
|---|---|
| AWS Lambda SQS (`src/Benzene.Aws.Lambda.Sqs`) | `SqsOptions.batchFailureMode` defaults `PartialBatchFailure` — failed messages reported via `ReportBatchItemFailures` |
| AWS DynamoDB Streams (`src/Benzene.Aws.Lambda.DynamoDb`) | Sequential processing stops at the first failed record and reports it as a batch item failure |
| Azure Queue Storage trigger (`src/Benzene.Azure.Function.QueueStorage`) | `raiseOnFailureStatus` defaults `true` — a failure result throws, so `maxDequeueCount` retry/poison handling applies |
| Azure Event Grid trigger (`src/Benzene.Azure.Function.EventGrid`) | `raiseOnFailureStatus` defaults `true` |
| Google Cloud Pub/Sub (`src/Benzene.GoogleCloud.Functions.PubSub`) | `raiseOnFailureStatus` defaults `true` |
| RabbitMQ worker (`src/Benzene.RabbitMq`) | `ackMode` defaults `Explicit` — a failure nacks for requeue/dead-letter |
| Azure Service Bus worker (`src/Benzene.Azure.ServiceBus`) | `ackMode` defaults `ServiceBusConsumerAckMode.Explicit` — a failure abandons the message |

**At-most-once by default — a knob exists but defaults off** (divergent from .NET, where the same
knob defaults `true`; the in-source rationale is the pre-1.0 one — "a failure result usually
reflects a permanent failure that retrying won't fix"):

| Transport | Opt-in |
|---|---|
| AWS SNS (`src/Benzene.Aws.Lambda.Sns`) | `SnsOptions.raiseOnFailureStatus = true` |
| Azure Service Bus trigger (`src/Benzene.Azure.Function.ServiceBus`) | `ServiceBusOptions.raiseOnFailureStatus = true` |
| Azure Kafka trigger (`src/Benzene.Azure.Function.Kafka`) | `KafkaOptions.raiseOnFailureStatus = true` |

**No escalation knob at all — not implemented** (in .NET each of these has one; here a returned
failure result is always settled, so the handler must **throw** for anything that must retry):

| Transport | State |
|---|---|
| AWS EventBridge (`src/Benzene.Aws.Lambda.EventBridge`) | No options type; .NET has `RaiseOnFailureStatus` (default `true`) |
| AWS S3 (`src/Benzene.Aws.Lambda.S3`) | No options type; .NET has `RaiseOnFailureStatus` (default `true`) |
| AWS Kafka/MSK trigger (`src/Benzene.Aws.Lambda.Kafka`) | No `batchFailureMode`; .NET defaults to partial-batch-failure reporting |
| AWS Kinesis (`src/Benzene.Aws.Lambda.Kinesis`) | Per-record fan-out **adaptation** — the C# streaming/checkpoint engine is not ported (stated in the package's own ADAPTATION note), so there is no per-record checkpoint semantics |
| Azure Event Hub trigger (`src/Benzene.Azure.Function.EventHub`) | No `raiseOnFailureStatus`; .NET has one (default `true`) |

**The two self-hosted stream workers deliberately default to at-most-once** — this matches .NET
and is a design decision, not a gap: a stream has no per-message ack, so the only safe-by-default
alternative is halting the worker on every poison record. `src/Benzene.Kafka.Core` defaults
`commitOnlyOnSuccess: false` and `src/Benzene.Azure.EventHub` defaults
`catchHandlerExceptions: true` (skip-and-continue); opt into at-least-once with
`commitOnlyOnSuccess: true` / `catchHandlerExceptions: false` and accept that a poison record then
halts the worker until handled or dead-lettered.

## Why "we don't do that" is a feature

Every deliberate "no" above buys you something: you keep the full power of the tool you chose,
you're never blocked by a leaky abstraction, and the surface you depend on stays small and stable.
When you need something this port doesn't ship, the extension model (custom middleware, custom
pipes, the getter/setter mapper pattern) is a supported, documented path — and where this port
does less than the .NET original (outbox, claim check, retry jitter), the row above says so
plainly rather than papering over it.

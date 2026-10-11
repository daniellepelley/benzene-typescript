# Capability Matrix — what this port does, deliberately doesn't, and how to fill the gap

Benzene is honest about its boundaries. This page is the single place that states, for the
TypeScript port, **what is provided** (with the package that provides it), **what is deliberately
not done and why**, and **how to solve the rest outside Benzene**. Nothing here is a hidden gap —
a deliberate "no" is a design decision stated with its reasoning; a plain "not implemented" is an
honest omission, and the two are never conflated. Where this port does less than the .NET
original, the row says so.

*Refreshed 2026-10-11 against `src/` and `test/` at `6e94d11`: the settlement breakdown, its summary
row, the Kafka row's opt-in note and the Conformance row were re-verified from source. Other rows
were not re-verified in this pass.*

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
| **Kafka** | Self-hosted consumer-group worker with health check (`src/Benzene.Kafka.Core`), AWS Lambda MSK trigger (`src/Benzene.Aws.Lambda.Kafka`), Azure Functions Kafka trigger (`src/Benzene.Azure.Function.Kafka`) | At-least-once by default on the self-hosted worker is deliberately NOT the default — a stream has no per-message ack, so `commitOnlyOnSuccess` defaults `false` (skip-and-continue, at-most-once); halting on every poison record is too drastic a default | `commitOnlyOnSuccess: true` (with `catchHandlerExceptions: false`) for at-least-once on **thrown exceptions** only. The worker never reads a returned failure result, so that is still committed: throw to retry. See [Getting started with Kafka](getting-started-kafka.md) and the settlement breakdown below |
| **RabbitMQ** | Self-hosted worker with `Explicit`/`AutoAck` settlement (default `Explicit` — safe), requeue-on-failure, health check, test helpers (`src/Benzene.RabbitMq`, `src/Benzene.RabbitMq.TestHelpers`) | — | No dedicated doc page yet (an omission, not a decision) — mentions in [Hosting](hosting.md) and [Health Checks](health-checks.md); the package source and its `index.ts` are the current reference |
| **AWS** | Lambda adapters: API Gateway, SQS, SNS, EventBridge, DynamoDB Streams, Kinesis, S3, Kafka/MSK, X-Ray (`src/Benzene.Aws.Lambda.*`); self-hosted SQS consumer (`src/Benzene.Aws.Sqs`); outbound clients for SQS/SNS/EventBridge/Lambda/Step Functions (`src/Benzene.Clients.Aws.*`); test helpers | Wrap the AWS SDK — the native Lambda event/record is on every context | [Getting started on AWS](getting-started-aws.md); SDK calls live in your handler |
| **Azure** | Functions triggers: HTTP, Service Bus, Event Hub, Event Grid, Queue Storage, Blob Storage, Cosmos DB change feed, Kafka, Timer (`src/Benzene.Azure.Function.*`); self-hosted Service Bus and Event Hub workers (`src/Benzene.Azure.ServiceBus`, `src/Benzene.Azure.EventHub`); Cosmos DB change-feed processing (`src/Benzene.Azure.CosmosDb`); outbound clients (`src/Benzene.Clients.Azure.*`) | Same — the native trigger payload is on the context | [Getting started on Azure](getting-started-azure.md), [Azure Functions Setup](azure-functions.md) |
| **Google Cloud** | Cloud Functions HTTP + Pub/Sub adapters with test helpers (`src/Benzene.GoogleCloud.Functions.*`); Pub/Sub outbound client (`src/Benzene.Clients.GoogleCloud.PubSub`) | — | [Getting started on Google Cloud](getting-started-google.md) |
| **Mesh — service side** | Mesh wire shapes, descriptor factory, schema provider (`src/Benzene.Mesh.Wire`, `src/Benzene.Mesh.Contracts`, `src/Benzene.Mesh.Dispatch`), announcement from the service (`MeshAnnouncer` in `src/Benzene.CloudService`), per-platform sources (`src/Benzene.Mesh.Aws.Lambda`) | — | The mesh contracts are normative in the [spec](https://github.com/daniellepelley/Benzene/tree/main/docs/specification) |
| **Mesh — collector, fleet & UI** | Collector + read models (`src/Benzene.Mesh.Collector`, `src/Benzene.Mesh.Aggregator`, `src/Benzene.Mesh.Reporting`); discovery for AWS/Azure/Kubernetes (`src/Benzene.Mesh.Discovery.*`); fleet tracing sources for X-Ray/Jaeger/Tempo (`src/Benzene.Mesh.Fleet.*`, `src/Benzene.Mesh.Tracing.Tempo`); usage feeds for CloudWatch/Application Insights (`src/Benzene.Mesh.Usage.*`); storage on S3/Blob/GCS (`src/Benzene.Mesh.{Aws.S3,Azure.Blob,GoogleCloud.Storage}`); served UI (`src/Benzene.Mesh.Ui`) | — | Doc pages for the mesh UI and usage feed are still being ported (an omission, not a decision) — the runnable [`examples/mesh-service`](https://github.com/daniellepelley/benzene-typescript/tree/main/examples/mesh-service) is the current reference |
| **Health checks** | Builder + processor core (`src/Benzene.HealthChecks`, `src/Benzene.HealthChecks.Core`); disk/HTTP/TCP/DynamoDB/TypeORM/schema/Service Bus checks (`src/Benzene.HealthChecks.*`); transport-embedded checks (Kafka, RabbitMQ); external probe (`src/Benzene.CloudService.Probe`); client-side checks (`src/Benzene.Clients.HealthChecks`) | Ship a check for every dependency — the check interface is the seam | [Health Checks](health-checks.md), [Kubernetes Health Checks](kubernetes-health-checks.md) |
| **Spec endpoint / Cloud Service Profile** | The profile report and reserved paths (`src/Benzene.CloudService`), plus a served spec UI (`src/Benzene.Spec.Ui`) | — | Profile shape is normative in the [spec](https://github.com/daniellepelley/Benzene/tree/main/docs/specification) |
| **Codegen & clients** | Typed client generation from a committed contract document (`src/Benzene.CodeGen.Client`, with a CLI); outbound routing, retries, fan-out (`src/Benzene.Clients`); in-process transport for the modular monolith (`src/Benzene.Clients.InProcess`) | Require another language's SDK to call a Benzene service — the contract document is enough | [Clients](clients.md), [Generating a client from a Contract Document](codegen-contract-document.md) |
| **Caching** | Cache abstraction (`src/Benzene.Cache.Core`) + Redis adapter (`src/Benzene.Cache.Redis`) | Grow into a general state-store abstraction (a database is not a transport) | [Caching](caching.md), [Redis caching](cookbooks/redis-caching.md) |
| **Validation** | Adapters for Zod, Joi, Yup, and JSON Schema via ajv (`src/Benzene.Zod`, `src/Benzene.Joi`, `src/Benzene.Yup`, `src/Benzene.Ajv`) over a shared validation abstraction (`src/Benzene.Abstractions.Validation`) | Port the .NET validation libraries — third-party integrations are re-created against the popular JS-ecosystem equivalents, by convention | [Validation](validation.md); one small adapter package per library is the pattern to copy for others |
| **Serialization** | JSON by default; XML, MessagePack, and Avro adapters (`src/Benzene.Xml`, `src/Benzene.MessagePack`, `src/Benzene.Avro`) | — | [Serialization & Media Formats](serialization.md) |
| **Versioning** | Payload version casting for requests, responses, and schemas (`src/Benzene.Core.Versioning`) | — | [Message versioning](cookbooks/message-versioning.md) |
| **AuthN / AuthZ** | OAuth2 bearer (JWT via `jose`) with a **required, no-default** signing-algorithm allowlist and scope claims (`src/Benzene.Auth.OAuth2`); Basic auth (`src/Benzene.Auth.Basic`); shared seams (`src/Benzene.Auth.Core`) | Ship a policy-engine (OPA/Cedar) adapter | Add an authorization middleware calling your policy engine on the `Benzene.Auth.Core` seams; see [Auth patterns](cookbooks/auth-patterns.md) |

## Cross-cutting production concerns

| Capability | What this port provides | What it deliberately does NOT do (and why) | How to solve the rest |
|---|---|---|---|
| **Transport features** | Full, direct access to the native SDK message/event on every adapter's context | Hide transport-specific capabilities behind a generic interface (the anti-pattern above) | Use the raw SDK feature directly — the context exposes the native message/event |
| **Message routing** | Topic-based dispatch to `@message` handlers (`src/Benzene.Core.MessageHandlers`); the same handler runs behind every transport | Impose a canonical envelope on transports that already carry routing (Kafka topic, Service Bus properties) | For envelope-less transports use the Benzene envelope or a preset topic; otherwise route on the native key. See [Message Handlers](message-handlers.md) |
| **Idempotency** | `IIdempotencyStore` seam + `InMemoryIdempotencyStore` (single-process) + atomic-claim middleware (`src/Benzene.Idempotency`) | Cross-instance de-duplication — independent processes can't coordinate at runtime without external state, and shared state can relocate the race, not remove it | An external store with an **atomic conditional write** (DynamoDB conditional put, Redis `SET NX`) keyed on message identity, plus naturally idempotent handlers. See [Idempotency](cookbooks/idempotency.md) |
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
| **Retry on a returned failure result** | Per-binding settlement, with knobs on most bindings. See the [breakdown below](#returned-failure-result-settlement--the-per-transport-breakdown). A returned failure result is redelivered by default on Lambda SQS, DynamoDB Streams, the self-hosted SQS consumer, Event Grid, Queue Storage, Pub/Sub, RabbitMQ and the Service Bus worker. **A missing result is redelivered only on the self-hosted SQS consumer and the Service Bus worker** | A single cross-transport reliability abstraction: retry semantics are transport-native. **The .NET 1.0 settlement contract is not fully ported.** Three adapters default their knob off. Seven bindings have no knob. Ten bindings acknowledge a missing result that .NET redelivers. The breakdown states each one | Find your binding's row. Where a knob exists, opt in. Where none exists, have the handler **throw** for anything that must be retried, and make sure every pipeline path records a result. Any retried handler must be idempotent. See [Message Results](message-result.md) and the failure-handling cookbooks |
| **Multi-tenancy** | *(nothing as a framework feature today)* | — | Roll a tenant-resolver middleware + a scoped tenant holder — the documented [Multi-Tenancy](cookbooks/multi-tenancy.md) pattern |
| **Conformance** | `test/Benzene.Core.Test/Conformance/` runs the vendored language-neutral fixtures under `npm test` (CI: `build.yml`). The fixtures are a snapshot of the main repo's `docs/specification/conformance/`, pinned by `SPEC_VERSION` to `spec-0.1.0`, and all 14 canonical files are vendored. **12 are opened by a runner**: `envelope-cases`, `http-status-mapping`, `grpc-status-mapping`, `status-vocabulary`, `problem-details-cases`, `transport-metadata-cases`, `contract-document-cases`, `contract-hash-cases`, `mesh-descriptor-cases`, `mesh-trace-cases`, `mesh-collector-cases`, `mesh-issue-cases`. `ConformanceCoverageTest` fails if a vendored fixture has no `load(...)` runner and is not on its opt-out list. `ConformanceDriftTest` and `conformance-drift-check.yml` compare the snapshot byte-for-byte with the canonical copy at the pin. **Not run (not implemented):** `mesh-service-version-cases` and `mesh-version-order-cases`. They are on the opt-out list "awaiting a cross-port claim-or-drop decision", and this port has no `MeshServiceVersion` type | Edit a fixture to make this port pass. The fixture is the neutral truth | A mismatch is either a bug here or a deliberate spec change in the main repo. It is never fixed by patching the fixture |

## Returned-failure-result settlement — the per-transport breakdown

What each inbound binding does with a delivery, by outcome. Each row was verified against `src/` on
2026-10-11 and names the class that makes the decision. The columns:

- **Failure result:** the handler returned `isSuccessful === false`.
- **No result:** the pipeline finished without recording one. A middleware short-circuited, a
  `use(...)` step consumed the message, or a non-envelope message fell through `useBenzeneMessage`.
  Most adapters test `isSuccessful === false`, so an absent result reads as success.
- **Unmatched topic:** no handler matches. `MessageRouter.handleAsync`
  (`src/Benzene.Core.MessageHandlers/MessageRouter.ts`) records a `not-found` **failure** result. A
  missing topic records `validation-error`. On every routed binding this column therefore follows
  the failure column. No binding special-cases it, and none offers to treat it as `ignored`.

The settlement words:

- **redeliver:** not settled. The platform delivers the message again, subject to its own
  redrive, DLQ or max-delivery configuration.
- **acknowledged (dropped):** settled as done and never redelivered.
- **skip-and-continue:** the stream position advances past it, so it is lost.
- **n/a:** the binding has no per-message result.

| Binding | Package — where decided | Failure result | No result | Unmatched topic | Uncaught exception | Override knob (default) | Unit of settlement |
|---|---|---|---|---|---|---|---|
| AWS Lambda SQS | `src/Benzene.Aws.Lambda.Sqs` — `SqsApplication.handleAsync`, `SqsOptions` | redeliver ¹ | acknowledged (dropped) | redeliver | redeliver (caught, reported as a batch item failure) | `SqsOptions.batchFailureMode` (`PartialBatchFailure`); `FailWholeBatch` throws so the whole batch redelivers. No at-most-once option | per message (whole batch under `FailWholeBatch`) |
| AWS Lambda SNS | `src/Benzene.Aws.Lambda.Sns` — `SnsApplication.handleAsync`, `SnsOptions` | acknowledged (dropped) | acknowledged (dropped), even with the knob on | acknowledged (dropped); redeliver with the knob on | redeliver (cascades) | `raiseOnFailureStatus` (`false`); `catchExceptions` (`false`) | invocation: a throw fails every record in the event |
| AWS Lambda EventBridge | `src/Benzene.Aws.Lambda.EventBridge` — `EventBridgeApplication` (base `MiddlewareApplication`) | acknowledged (dropped) | acknowledged (dropped) | acknowledged (dropped) | redeliver (propagates) | none (no options type) | per event (one per invocation) |
| AWS Lambda S3 | `src/Benzene.Aws.Lambda.S3` — `S3Application` (base `MiddlewareMultiApplication`) | acknowledged (dropped) | acknowledged (dropped) | acknowledged (dropped) | redeliver (propagates) | none (no options type) | invocation: a throw fails every record in the event |
| AWS Lambda DynamoDB Streams | `src/Benzene.Aws.Lambda.DynamoDb` — `DynamoDbApplication.handleAsync` | redeliver ¹ (processing stops at the record) | acknowledged (dropped): processing continues past it | redeliver | redeliver (caught, reported) | none. No at-most-once option | position: sequence number of the first failed record (records run in order) |
| AWS Lambda Kinesis | `src/Benzene.Aws.Lambda.Kinesis` — `KinesisApplication` | acknowledged (dropped): `isSuccessful` is recorded but never read | acknowledged (dropped) | acknowledged (dropped) | redeliver (propagates) | none | invocation (whole batch). Records run concurrently, so shard order is not kept |
| AWS Lambda Kafka/MSK | `src/Benzene.Aws.Lambda.Kafka` — `KafkaApplication` (base `MiddlewareMultiApplication`) | acknowledged (dropped) | acknowledged (dropped) | acknowledged (dropped) | redeliver (propagates) | none (no `batchFailureMode`) | invocation (whole batch, all partitions) |
| Self-hosted SQS consumer | `src/Benzene.Aws.Sqs` — `SqsConsumerApplication.handleAsync`, `SqsConsumer.startAsync` | redeliver (not deleted) | redeliver: only `isSuccessful === true` is deleted | redeliver | redeliver (contained, not deleted) | `SqsConsumerOptions.ackMode` (`PerMessage`). `WholeBatch` deletes failed and no-result messages with the batch, and keeps the whole batch on a throw | per message (poll batch under `WholeBatch`) |
| Azure Functions Service Bus trigger | `src/Benzene.Azure.Function.ServiceBus` — `ServiceBusBatchApplication`, `ServiceBusOptions` | acknowledged (dropped) | acknowledged (dropped), even with the knob on | acknowledged (dropped); redeliver with the knob on | redeliver (cascades) | `raiseOnFailureStatus` (`false`); `catchExceptions` (`false`) | invocation (one message, or the delivered batch) |
| Azure Functions Event Hub trigger | `src/Benzene.Azure.Function.EventHub` — `EventHubApplication`, `BenzeneMessageEventHubHandler` | acknowledged (dropped): routing is envelope-only and the envelope response is discarded | acknowledged (dropped), including a non-envelope event | acknowledged (dropped) | propagates and fails the invocation ² | none | invocation (the trigger batch, which the host checkpoints) |
| Azure Functions Event Grid | `src/Benzene.Azure.Function.EventGrid` — `EventGridBatchApplication`, `EventGridOptions` | redeliver | acknowledged (dropped) | redeliver | redeliver (cascades) | `raiseOnFailureStatus` (`true`); `catchExceptions` (`false`) | invocation (one event, or the delivered batch) |
| Azure Functions Queue Storage | `src/Benzene.Azure.Function.QueueStorage` — `QueueStorageBatchApplication`, `QueueStorageOptions`, `BenzeneMessageQueueStorageHandler` | redeliver | acknowledged (dropped) on the non-envelope path. Redeliver on the envelope path, because an unset envelope `statusCode` is not a success | redeliver | redeliver (cascades) | `raiseOnFailureStatus` (`true`); `catchExceptions` (`false`) | invocation (one message, or the delivered batch) |
| Azure Functions Kafka trigger | `src/Benzene.Azure.Function.Kafka` — `KafkaBatchApplication`, `KafkaOptions` | acknowledged (dropped) | acknowledged (dropped), even with the knob on | acknowledged (dropped); redeliver with the knob on | propagates and fails the invocation ² | `raiseOnFailureStatus` (`false`); `catchExceptions` (`false`) | invocation (whole batch) |
| Azure Functions Cosmos DB trigger | `src/Benzene.Azure.Function.CosmosDb` — `useCosmosDbChangeFeed` (`StreamingExtensions.ts`) | n/a (fan-in `StreamContext`, no routing) | n/a | n/a | redeliver (the lease is not checkpointed) | none | batch (lease) |
| Azure Functions Blob trigger | `src/Benzene.Azure.Function.BlobStorage` — `BlobStorageApplication` | n/a (`useBlob`, no routing) | n/a | n/a | propagates and fails the invocation | none | per blob |
| Azure Functions Timer | `src/Benzene.Azure.Function.Timer` — `TimerApplication` | acknowledged: the invocation succeeds silently, and there is nothing to redeliver | acknowledged | acknowledged (preset topic) | propagates and fails the invocation. The next tick runs on schedule | none | per tick |
| Self-hosted Service Bus worker | `src/Benzene.Azure.ServiceBus` — `BenzeneServiceBusWorker.handleMessageAsync` / `settleAsync` | redeliver (abandon) | redeliver (abandon) | redeliver (abandon) | redeliver (abandon) | `BenzeneServiceBusConfig.ackMode` (`Explicit`). `AutoComplete` completes on a failure or a missing result. Per message, a handler can set `ServiceBusSettlementHolder.override` (`Complete`/`Abandon`/`DeadLetter`/`Defer`) | per message |
| Self-hosted Event Hub worker | `src/Benzene.Azure.EventHub` — `BenzeneEventHubWorker.onProcessEventsAsync`, `BenzeneEventHubConfig` | skip-and-continue (escalated, then caught) | acknowledged (checkpointed) | skip-and-continue | skip-and-continue | `catchHandlerExceptions` (`true`); `false` halts the worker without checkpointing. `raiseOnFailureStatus` (`true`) | position: partition checkpoint every `checkpointInterval` (`1`) events |
| Self-hosted Kafka worker | `src/Benzene.Kafka.Core` — `BenzeneKafkaWorker.onEachMessage` | acknowledged (committed): the result is never read, even under `commitOnlyOnSuccess: true` | acknowledged (committed) | acknowledged (committed) | skip-and-continue. Under `catchHandlerExceptions: false` the worker halts without committing | `commitOnlyOnSuccess` (`false`); `catchHandlerExceptions` (`true`). No `raiseOnFailureStatus` | position: partition offset (kafkajs auto-commit, or `offset + 1` per record under `commitOnlyOnSuccess`) |
| RabbitMQ worker | `src/Benzene.RabbitMq` — `RabbitMqWorker.handleDeliveryAsync` / `nack` | redeliver (nack). Requeued once; a failure on an already-redelivered message goes to the DLX, or is dropped if there is none | acknowledged (dropped): acked | redeliver | redeliver (nack) | `RabbitMqConfig.ackMode` (`Explicit`); `AutoAck` is at-most-once. `requeueOnFailure` (`true`) | per delivery |
| Google Cloud Pub/Sub | `src/Benzene.GoogleCloud.Functions.PubSub` — `PubSubMiddlewareApplication`, `PubSubOptions` | redeliver | acknowledged (dropped) | redeliver | redeliver (cascades) | `raiseOnFailureStatus` (`true`); `catchExceptions` (`false`) | per message |
| Self-hosted Cosmos DB change feed | `src/Benzene.Azure.CosmosDb` — `BenzeneCosmosChangeFeedWorker`, `BenzeneCosmosAllVersionsChangeFeedWorker` | n/a (fan-in) | n/a | n/a | redeliver (the batch is not checkpointed) | `catchHandlerExceptions` (`false`); `true` checkpoints past the batch (skip-and-continue). `autoCheckpointOnSuccess` (`true`, latest-version worker only) | batch (lease checkpoint) |

Request/response bindings settle nothing; the result goes back to the caller. These are HTTP
(Express, API Gateway, Azure Functions HTTP, Cloud Functions HTTP), gRPC, and a direct Lambda
invoke of the Benzene envelope (`BenzeneMessageLambdaHandler`).

On every adapter that has `catchExceptions`, setting it to `true` turns an uncaught exception into
acknowledged (dropped). It is the at-most-once switch for exceptions.

¹ Partial reporting needs `ReportBatchItemFailures` on the event source mapping. Without it, Lambda
ignores the returned failures and the batch is acknowledged.
² Benzene's part ends at failing the invocation. Whether the Functions host then redelivers a failed
Event Hubs or Kafka trigger batch depends on the host's retry-policy configuration. This port does
not set that policy and has not verified it, so treat redelivery as **unknown** until you configure
the policy yourself.

**Divergences from the .NET 1.0 settlement contract.** The .NET rule has three parts:

- On queue-shaped bindings, a failure result or a missing result is redelivered like an uncaught
  exception.
- The self-hosted stream workers default to at-most-once.
- .NET's matrix treats an unrouted message as a missing result, and accepts it on its five stream
  bindings (MSK, the Functions Kafka and Event Hub triggers, and both stream workers).

This port differs in four ways:

1. **A failure result is accepted by default.** The knob exists but defaults `false`; .NET defaults
   it `true`. This applies to Lambda SNS, the Functions Service Bus trigger and the Functions Kafka
   trigger. The in-source rationale (SNS, Kafka) is the pre-1.0 one: "a failure result usually
   reflects a permanent/business-logic failure that retrying won't fix".
2. **There is no failure-result knob at all.** A returned failure is always settled, so the handler
   must throw to get a retry. This applies to:
   - Lambda EventBridge and S3.
   - Kinesis, which uses a per-record fan-out adaptation because the C# checkpoint engine is not
     ported.
   - Kafka/MSK, which has no `batchFailureMode`.
   - The Functions Event Hub trigger.
   - The Functions Timer. .NET's `TimerOptions.RaiseOnFailureStatus` only makes a failure visible.
   - The self-hosted Kafka worker. .NET's `BenzeneKafkaConfig.RaiseOnFailureStatus` (default `true`)
     is not ported, so `commitOnlyOnSuccess: true` gives at-least-once for thrown exceptions only.
3. **A missing result is acknowledged where .NET redelivers it.** This applies to ten bindings:
   Lambda SQS, SNS, EventBridge, S3 and DynamoDB Streams; the Functions Service Bus, Event Grid and
   Queue Storage triggers (Queue Storage on its non-envelope path); Pub/Sub; and RabbitMQ. Even
   where `raiseOnFailureStatus` is on, these adapters test `isSuccessful === false`, so an absent
   result never escalates. Only the self-hosted SQS consumer and the Service Bus worker redeliver
   it.
4. **An unmatched topic is a `not-found` failure here, not a missing result.** No binding offers
   to treat it as `ignored`. This has two effects today:
   - On the self-hosted Event Hub worker, opting into at-least-once (`catchHandlerExceptions:
     false`) halts the worker on an unmatched event, which .NET settles.
   - On the Functions Kafka trigger, `raiseOnFailureStatus: true` replays the batch for an
     unmatched record, which .NET settles.

   Turning on failure escalation for MSK or the Functions Event Hub trigger without a matching
   carve-out would cause the same replays.

The port already matches .NET in these places:

- The self-hosted SQS consumer and Service Bus worker, on all four outcomes.
- The Event Hub worker's defaults.
- Failure-result handling on Lambda SQS, DynamoDB Streams, Event Grid, Queue Storage, Pub/Sub and
  RabbitMQ.
- The Cosmos DB fan-in bindings.

**The two self-hosted stream workers deliberately default to skip-and-continue.** .NET makes the
same design decision; it is not a gap. A stream has no per-message ack, so the only safe-by-default
alternative is halting the worker on every poison record. To opt into at-least-once:

- Event Hub: set `catchHandlerExceptions: false`.
- Kafka: set `commitOnlyOnSuccess: true` together with `catchHandlerExceptions: false` (enforced
  at startup). This covers thrown exceptions only (item 2).

Either way, a poison record then halts the worker until it is handled or dead-lettered.

## Why "we don't do that" is a feature

Every deliberate "no" above buys you something: you keep the full power of the tool you chose,
you're never blocked by a leaky abstraction, and the surface you depend on stays small and stable.
When you need something this port doesn't ship, the extension model (custom middleware, custom
pipes, the getter/setter mapper pattern) is a supported, documented path — and where this port
does less than the .NET original (outbox, claim check, retry jitter, settlement defaults), the row above says so
plainly rather than papering over it.

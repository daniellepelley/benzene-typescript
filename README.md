# Benzene (TypeScript)

TypeScript port of [Benzene](https://github.com/daniellepelley/benzene), a middleware-based
library supporting hexagonal (ports-and-adapters) architecture. It provides a pipeline of
middleware components that wrap calls to "ports" (interfaces representing external boundaries —
DB, HTTP, queues, etc).

The port tracks the .NET original as closely as TypeScript allows: same repository layout, one
npm package per C# project, same type names, same file names, and tests ported from the C# test
suite. Where the languages force a difference, the deviation is deliberate, minimal and
documented (see [Porting conventions](#porting-conventions)).

## Structure

Mirrors the .NET repository:

- `src/` — library source, one directory per C# project
- `test/` — tests, mirroring `test/` in the .NET repository
- `.github/workflows/` — CI

| Package | npm name | .NET counterpart |
| --- | --- | --- |
| `src/Benzene.Abstractions` | `@benzene/abstractions` | `Benzene.Abstractions` |
| `src/Benzene.Abstractions.Middleware` | `@benzene/abstractions-middleware` | `Benzene.Abstractions.Middleware` |
| `src/Benzene.Core` | `@benzene/core` | `Benzene.Core` |
| `src/Benzene.Core.Middleware` | `@benzene/core-middleware` | `Benzene.Core.Middleware` |
| `src/Benzene.Abstractions.Messages` | `@benzene/abstractions-messages` | `Benzene.Abstractions.Messages` (partial) |
| `src/Benzene.Abstractions.MessageHandlers` | `@benzene/abstractions-message-handlers` | `Benzene.Abstractions.MessageHandlers` (partial) |
| `src/Benzene.Core.Messages` | `@benzene/core-messages` | `Benzene.Core.Messages` (partial) |
| `src/Benzene.Core.MessageHandlers` | `@benzene/core-message-handlers` | `Benzene.Core.MessageHandlers` (partial) |
| `src/Benzene.Results` | `@benzene/results` | `Benzene.Results` (partial) |
| `src/Benzene.Abstractions.Validation` | `@benzene/abstractions-validation` | `Benzene.Abstractions.Validation` |
| `src/Benzene.Zod` | `@benzene/zod` | `Benzene.FluentValidation`† (Zod adapter) |
| `src/Benzene.Joi` | `@benzene/joi` | `Benzene.FluentValidation`† (Joi adapter) |
| `src/Benzene.Yup` | `@benzene/yup` | `Benzene.FluentValidation`† (Yup adapter) |
| `src/Benzene.Resilience` | `@benzene/resilience` | `Benzene.Resilience` |
| `src/Benzene.Diagnostics` | `@benzene/diagnostics` | `Benzene.Diagnostics` (partial) |
| `src/Benzene.Http` | `@benzene/http` | `Benzene.Http` |
| `src/Benzene.Aws.Lambda.Core` | `@benzene/aws-lambda-core` | `Benzene.Aws.Lambda.Core` |
| `src/Benzene.Aws.Lambda.Sqs` | `@benzene/aws-lambda-sqs` | `Benzene.Aws.Lambda.Sqs` |
| `src/Benzene.Aws.Lambda.ApiGateway` | `@benzene/aws-lambda-api-gateway` | `Benzene.Aws.Lambda.ApiGateway` |
| `src/Benzene.Aws.Lambda.{Sns,DynamoDb,Kinesis,S3,EventBridge,Kafka}` | `@benzene/aws-lambda-{sns,dynamodb,kinesis,s3,eventbridge,kafka}` | same-named `Benzene.Aws.Lambda.*` |
| `src/Benzene.Azure.Function.Core` | `@benzene/azure-function-core` | `Benzene.Azure.Function.Core` |
| `src/Benzene.Azure.Function.ServiceBus` | `@benzene/azure-function-service-bus` | `Benzene.Azure.Function.ServiceBus` |
| `src/Benzene.Azure.Function.Http` | `@benzene/azure-function-http` | `Benzene.Azure.Function.AspNet`‡ |
| `src/Benzene.Azure.Function.{EventHub,Kafka}` | `@benzene/azure-function-{event-hub,kafka}` | same-named `Benzene.Azure.Function.*` |
| `src/Benzene.Clients` | `@benzene/clients` | `Benzene.Clients` (partial) |
| `src/Benzene.Client.Http` | `@benzene/client-http` | `Benzene.Client.Http` |
| `src/Benzene.Cache.Core` | `@benzene/cache-core` | `Benzene.Cache.Core` (partial) |
| `src/Benzene.Cache.Redis` | `@benzene/cache-redis` | `Benzene.Cache.Redis`§ |
| `src/Benzene.HealthChecks.Core` | `@benzene/health-checks-core` | `Benzene.HealthChecks.Core` |
| `src/Benzene.HealthChecks` | `@benzene/health-checks` | `Benzene.HealthChecks` |
| `src/Benzene.HealthChecks.Http` | `@benzene/health-checks-http` | `Benzene.HealthChecks.Http` |
| `src/Benzene.HealthChecks.Tcp` | `@benzene/health-checks-tcp` | `Benzene.HealthChecks.Tcp` (over `node:net`) |
| `src/Benzene.HealthChecks.Disk` | `@benzene/health-checks-disk` | `Benzene.HealthChecks.Disk` (over `node:fs`) |
| `src/Benzene.Clients.HealthChecks` | `@benzene/clients-health-checks` | `Benzene.Clients.HealthChecks` |
| `src/Benzene.Avro` | `@benzene/avro` | `Benzene.Avro`† (avsc adapter) |
| `src/Benzene.MessagePack` | `@benzene/messagepack` | `Benzene.MessagePack`† (`@msgpack/msgpack` adapter) |
| `src/Benzene.Xml` | `@benzene/xml` | `Benzene.Xml`† (`fast-xml-parser` adapter) |
| `src/Benzene.Extras` | `@benzene/extras` | `Benzene.Extras` |
| `src/Benzene.Auth.Core` | `@benzene/auth-core` | `Benzene.Auth.Core` (+ minimal `System.Security.Claims`) |
| `src/Benzene.Auth.Basic` | `@benzene/auth-basic` | `Benzene.Auth.Basic` |
| `src/Benzene.Auth.OAuth2` | `@benzene/auth-oauth2` | `Benzene.Auth.OAuth2`† (jose adapter) |
| `src/Benzene.Idempotency` | `@benzene/idempotency` | `Benzene.Idempotency` |
| `src/Benzene.RateLimiting` | `@benzene/rate-limiting` | `Benzene.RateLimiting` (+ `System.Threading.RateLimiting` subset) |
| `src/Benzene.SelfHost` | `@benzene/self-host` | `Benzene.SelfHost` (+ `System.Threading.Channels` subset) |
| `src/Benzene.SchemaRegistry.Core` | `@benzene/schema-registry-core` | `Benzene.SchemaRegistry.Core` |
| `src/Benzene.Configuration.Core` | `@benzene/configuration-core` | `Benzene.Configuration.Core` |
| `src/Benzene.Saga` | `@benzene/saga` | `Benzene.Saga` |
| `src/Benzene.ResponseEvents` | `@benzene/response-events` | `Benzene.ResponseEvents` |
| `src/Benzene.Dependencies` | `@benzene/dependencies` | `Benzene.Microsoft.Dependencies`* |
| `test/Benzene.Core.Test` | `@benzene/core-test` (private) | `Benzene.Core.Test` |

\* Node has no platform DI container equivalent to `Microsoft.Extensions.DependencyInjection`,
so `@benzene/dependencies` ships a first-party `ServiceCollection` /
`DefaultBenzeneServiceContainer` / `DefaultServiceResolverFactory` with the same
singleton/scoped/transient semantics.

‡ `Benzene.Azure.Function.AspNet` routes Azure Functions HTTP through the .NET-only ASP.NET Core
stack (`HttpRequest`/`IActionResult`). Per the "Third-party library integrations" convention it is
retargeted onto the ecosystem-native `@azure/functions` v4 HTTP model (`HttpRequest`/
`HttpResponseInit`) and named `@benzene/azure-function-http`. Transport adapters likewise target the
Node event types: the AWS Lambda packages depend on `@types/aws-lambda`, the Azure packages on
`@azure/functions` (+ `@azure/service-bus`). The one structural adaptation across all AWS adapters:
.NET Lambda takes a raw `Stream` and deserializes/sniffs it to route, whereas Node Lambda receives an
already-parsed event object — so `AwsEventStreamContext` holds the parsed event and the router
discriminates on its shape rather than deserializing a stream.

§ `Benzene.Cache.Redis` wraps the .NET-only `StackExchange.Redis`; per the same convention it is
re-created as an adapter over `ioredis`, the popular Node Redis client. (`@benzene/clients` also
depends on the Node global `fetch` rather than .NET's `HttpClient`.)

† Marks a third-party-library integration re-created against the JavaScript ecosystem rather than
ported literally, per the "Third-party library integrations" convention. **Validation:** .NET's
`Benzene.DataAnnotations` (→ `System.ComponentModel.DataAnnotations`) and `Benzene.FluentValidation`
(→ FluentValidation) become adapters over the popular JS validation libraries (Zod, Joi, Yup), all
three mirroring the `Benzene.FluentValidation` integration shape. **Serialization:** `Benzene.Avro`
(→ Apache.Avro), `Benzene.MessagePack` (→ MessagePack-CSharp) and `Benzene.Xml` (→
`System.Xml.Serialization`) become adapters over `avsc`, `@msgpack/msgpack` and `fast-xml-parser`,
each mirroring the .NET package's `IMediaFormat` / serializer shape. **Auth:** `Benzene.Auth.OAuth2`
(→ `Microsoft.IdentityModel`'s `JsonWebTokenHandler` + JWKS `ConfigurationManager`) becomes an adapter
over `jose`, mirroring the middleware shape (`useOAuth2Bearer` / `requireScope`).

## Getting started

```bash
npm install     # install workspace dependencies
npm run build   # typecheck all packages (tsc --noEmit)
npm test        # run the test suite (vitest)
```

```ts
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer, ServiceCollection } from '@benzene/dependencies';

const services = new ServiceCollection();
const container = new DefaultBenzeneServiceContainer(services);

const builder = new MiddlewarePipelineBuilder<MyContext>(container);
builder
  .useExceptionHandler((context, error) => { /* map error onto context */ })
  .useFn('Auth', async (context, next) => {
    // before
    await next();
    // after
  })
  .onResponse((context) => { /* inspect result */ });

const pipeline = builder.build();

const factory = container.createServiceResolverFactory();
const resolver = factory.createScope();
await pipeline.handleAsync(new MyContext(), resolver);
resolver.dispose();
```

## Porting conventions

Rules applied consistently across the port, chosen to keep TypeScript code recognizable
next to its C# counterpart:

- **Names.** Type and file names are identical to C# (including the `I` interface prefix);
  methods and properties become camelCase (`HandleAsync` → `handleAsync`). The `Async` suffix
  is kept.
- **Types.** `Task`/`Task<T>` → `Promise<void>`/`Promise<T>`; C# `null` → `undefined`;
  `IDictionary<string, T>` → `Record<string, T>`; `Exception` → `Error`
  (`InnerException` → `Error.cause`); `IDisposable.Dispose()` → a `dispose()` method,
  called via try/finally where C# uses `using`.
- **Service resolution.** C# resolves services by runtime `Type`; TypeScript erases types, so
  every ported interface declares a merged `ServiceToken` constant of the same name.
  `resolver.GetService<IMiddlewareFactory>()` becomes `resolver.getService(IMiddlewareFactory)`.
  Classes act as their own identifier, like `typeof(MyMiddleware)`.
- **Constructor injection.** Implementation classes declare a static
  `inject: readonly ServiceIdentifier[]` array; the container resolves the identifiers and
  passes them as constructor arguments. `IEnumerable<T>` injection becomes
  `resolver.getServices(token)`.
- **Extension methods.** TypeScript has none. Fluent pipeline-builder extensions
  (`Use`, `OnRequest`, `OnResponse`, `Split`, `Convert`, `UseExceptionHandler`,
  `UseLogResult`, ...) become interface members implemented once in
  `MiddlewarePipelineBuilderBase`; non-fluent extensions (`TryAddSingleton`,
  `AddBenzeneMiddleware`, ...) become free functions in a file named after the C# extensions
  class.
- **Overloads.** Where C# overloads on delegate types that are indistinguishable at JavaScript
  runtime, methods split by name: `use(factoryOrMiddleware)` vs `useFn([name,] fn)`. Handler
  functions take `(context, next, serviceResolver)` — context-first, with the resolver as a
  trailing argument replacing the C# resolver-first overloads.
- **Arity-overloaded generic types.** `IMiddlewareApplication<TEvent>` and
  `IMiddlewareApplication<TEvent, TResult>` cannot share a name in TypeScript; the
  result-returning variants gain a `WithResult` suffix. Same for `IBenzeneResult<T>`
  (`IBenzeneResultOf<T>`) and C# `Void` (`VoidResult`, a reserved word).
- **Logging.** `Microsoft.Extensions.Logging` has no Node equivalent; `@benzene/abstractions`
  ships a minimal `ILogger`/`ILoggerFactory`/`LogLevel` with structured scopes, which adapters
  for concrete loggers can implement.
- **Handler discovery.** `IMessageHandlersFinder` remains the extension point, exactly as in
  .NET — only the default implementation differs. The C# `[Message("topic")]` attribute becomes
  the `@message('topic')` class decorator, which self-registers the class with a
  `MessageHandlersRegistry` when its module loads; `RegistryMessageHandlersFinder` (the
  counterpart of `ReflectionMessageHandlersFinder`) reads that registry, or an explicit class
  list (the C# `Type[]` constructor). `importMessageHandlers(dir)` recursively imports every
  module in a directory so decorated handlers are found automatically — the Node equivalent of
  assembly scanning. The `Dependency`/`Composite`/`Cache` finders and `MessageHandlersList`
  port unchanged, so discovery can be overridden the same way as in .NET.
- **Third-party library integrations.** Some .NET packages exist *only* to wrap a specific
  third-party library — e.g. `Benzene.DataAnnotations` wraps `System.ComponentModel.DataAnnotations`,
  `Benzene.FluentValidation` wraps FluentValidation, `Benzene.Autofac` wraps Autofac. These are
  **not** ported literally, because the wrapped library usually has no TypeScript existence. Instead
  the shared **abstraction** stays core and aligned (e.g. `Benzene.Abstractions.Validation` →
  `@benzene/abstractions-validation`), and each integration is re-created against the *popular
  equivalent library in the JavaScript ecosystem*, one adapter package per library. So .NET's
  validation integrations become `@benzene/zod`, `@benzene/joi`, `@benzene/yup` (schema validation),
  each mirroring the `Benzene.FluentValidation` integration shape (a `ValidationMiddleware` that
  resolves the schema for the request type and maps failures to a Benzene result). Rule of thumb:
  when a .NET package's reason for existing is the third party, find the 2–3 most-used ecosystem
  equivalents and adapt those; skip a candidate that is not widely used. Adapter packages *may*
  take their third-party library as a real runtime dependency (that is their whole purpose) — the
  "no runtime dependencies outside the workspace" rule applies to the core port, not to these
  deliberately library-specific adapters.

## Porting status and roadmap

Ported (with tests):

- `Benzene.Abstractions` (DI, logging, results, serialization abstractions)
- `Benzene.Abstractions.Middleware` (middleware, pipeline, applications, converters)
- `Benzene.Core` (constants, exceptions, dictionary helpers, log-context builders)
- `Benzene.Core.Middleware` (pipeline, builder + fluent extensions, exception handler,
  context converters, applications, routers, null objects)
- `Benzene.Dependencies` (first-party DI container)
- Message-handler discovery: topics, definitions, the `@message` decorator + registry,
  `RegistryMessageHandlersFinder` / `DependencyMessageHandlersFinder` /
  `CompositeMessageHandlersFinder` / `CacheMessageHandlersFinder` / `MessageHandlersList`,
  definition index + lookup, version selection, and `importMessageHandlers` directory scanning

- Message-handler execution: `BenzeneResult`/`BenzeneResultStatus`, `MessageHandler`,
  `MessageHandlerFactory` (container-resolved handlers), handler wrappers, default statuses
  and request-mapper thunks. C#'s expression-tree dispatch and its runtime split between
  response/no-response handler interfaces are unnecessary in JavaScript — closures close the
  generics, and a handler resolving `undefined` maps to `Accepted`.
- Message routing: `MessageRouter` (topic → lookup → factory → handler → result-setter, with
  the same short-circuit-on-error semantics as .NET), `MessageRouterBuilder`, the
  `IMessageHandlerContext` / `MessageHandlerContext` per-invocation context, the handler-pipeline
  vertical (`HandlerPipelineBuilder` + `PipelineMessageHandler` + `PipelineMessageHandlerWrapper`
  + `MessageHandlerMiddleware`), the boundary getters (`IMessageBodyGetter` /
  `IMessageHeadersGetter` / `IMessageTopicGetter` / `IMessageGetter`), `MessageHandlerResult`,
  and the two lightweight result-setter bases

- The `BenzeneMessage` transport (`Benzene.Core.Messages/BenzeneMessage`: request/response envelope
  `BenzeneMessageContext`, distinct from the handler-pipeline `MessageHandlerContext`), its handler
  glue (`BenzeneMessageGetter`, response adapter, status handler, result setter,
  `BenzeneMessageApplication`), `ResponseMessageMessageHandlerResultSetterBase`, the `PresetTopic`
  trio, and the top-level DI registration free functions (`addBenzene` / `addBenzeneMessage` /
  `addContextItems` / `addMessageHandlers` / `setApplicationInfo`) plus the pipeline-builder helpers
  (`useMessageHandlers`, `useMessageHandlersWithRouter`, `usePresetTopic`, `addMessageHandler`).
  C# open-generic registrations (`TryAddScoped(typeof(IFace<>), typeof(Impl<>))`) map to closed
  factory registrations under each shared `<unknown>` token, and C# assembly-scan handler discovery
  maps to the decorator-registry (`RegistryMessageHandlersFinder`).

- Outbound message senders and context predicates (`Benzene.Abstractions.Messages` senders +
  `BenzeneClient` client context, `Benzene.Core.Messages/MessageSender` + `Predicates`): the
  `IMessageSender` / `MessageSender` pair, `MessageSenderBuilder` and the `out(...)` registration
  free function, `BenzeneClientContext` / `BenzeneClientRequest` / `DefaultGetTopic` / `IGetTopic`,
  the sender/predicate definition interfaces (`IMessageSenderDefinition`, `IMessageSendersFinder`,
  `IBenzeneClientContextMiddlewareBuilder`), and the `IContextPredicate` family
  (`ContextPredicateBuilder`, `HeaderContextPredicate`, `MediaTypeHeaderContextPredicate`,
  `InlineContextPredicate`). Naming/arity decisions specific to this slice:
  - **Sender arity collision.** C# overloads both the interface and the class named
    `(I)MessageSender` on generic arity. Mirroring the handler precedent, the two-arg
    request/response variants keep the name (`IMessageSender<TRequest, TResponse>` /
    `MessageSender<TRequest, TResponse>`) and the one-arg no-response variants are renamed
    `IMessageSenderNoResponse<TRequest>` / `MessageSenderNoResponse<TMessage>`. Both container
    tokens follow the `<unknown>` precedent.
  - **`CreateSender` overload split.** C#'s arity-overloaded `CreateSender` becomes `createSender`
    (no response) and `createSenderWithResponse` (typed response), since the two are
    indistinguishable once generics erase.
  - **`BenzeneClientContext` shipped twice.** The .NET source contains this identical concrete class
    in both `Benzene.Abstractions.Messages.BenzeneClient` and `Benzene.Core.Messages.MessageSender`;
    the port mirrors both (one per package), and `MessageSender` uses the core-messages copy.
  - **Pipeline registration.** C# `TryAddScoped(_ => pipeline)` cannot be keyed by an erased
    per-context pipeline type in TypeScript, so each sender is registered by a factory closing over
    its built pipeline directly instead of resolving the pipeline from a token.
  - **`IGetTopic.getTopic`.** C# passes `typeof(TRequest)`, which is erased in TypeScript; the
    parameter is optional and `MessageSender` passes nothing (`DefaultGetTopic` ignores it).

- Request/response "context items" (`Benzene.Core.MessageHandlers` Request/Response/MediaFormats):
  `RequestMapper` / `EnrichingRequestMapper` / `MultiSerializerOptionsRequestMapper`, the response
  chain (`DefaultResponsePayloadMapper`, `ResponseHandlerContainer`, `RendererResponseHandler`,
  `SerializerResponseRenderer`, `ResponseIfHandledMessageHandlerResultSetter`), media-format
  negotiation (`JsonMediaFormat`, `MediaFormatNegotiator`, `AcceptHeaderMediaFormatBase`),
  `JsonSerializer`, and the transport/application `Info` types. Erasure handling: C#
  `Activator.CreateInstance<T>()` empty-body fallback → `{} as TRequest`; `DictionaryUtils.Enrich`
  reflection → a case-insensitive first-key-wins key merge; C# `is`/`as` interface checks →
  duck-typing guards.
- Validation: `@benzene/abstractions-validation` (schema interfaces, `IValidationStatusMapper` +
  shared `DefaultValidationStatusMapper`, `@validationStatus`) plus three ecosystem-native adapter
  packages — `@benzene/zod`, `@benzene/joi`, `@benzene/yup` — each mirroring the
  `Benzene.FluentValidation` integration shape (handler- and client-side `ValidationMiddleware` +
  builders, a schema registry keyed by request class, and a `use<Lib>Validation` router helper). The
  schema plays the role of FluentValidation's `IValidator<TRequest>`; the erased request type is
  recovered from the handler's `@message` metadata (handler side) or the message's constructor
  (client side). This is the "third-party integrations are adapted, not reimplemented" convention in
  action — .NET's `Benzene.DataAnnotations` / `Benzene.FluentValidation` (both wrapping .NET-only
  libraries) become adapters over the popular JS validation libraries instead.
- Resilience: `RetryMiddleware` (exponential backoff, faithful catch-filter semantics) + `useRetry`.
- Diagnostics: `TimerMiddleware` and the debug-middleware decorator/wrapper + `useTimer`, plus the
  correlation-id middleware and the process-timer surface. C# `Stopwatch` → `Date.now()` deltas;
  `Debug.WriteLine` → an injectable, silent-by-default sink; `Guid.NewGuid()` →
  `crypto.randomUUID()`.
- Distributed tracing & metrics (`@benzene/diagnostics`, over **`@opentelemetry/api`**): the
  span-per-middleware surface (`ActivityMiddlewareDecorator`/`Wrapper` + `addActivityPerMiddleware`/
  `addDiagnostics`, tagging `benzene.topic`/`version`/`transport`/`handler`/`status`), `useW3CTraceContext`
  (continues an inbound `traceparent` as the root span's remote parent), `useBenzeneMetrics` (the
  `benzene.messages.processed` counter + `benzene.message.duration` histogram, tagged topic/transport/
  result), `useBenzeneEnrichment` (log-scope + span enrichment), and the span-backed
  `ActivityProcessTimer`. .NET's `System.Diagnostics.Activity`/`ActivitySource`/`Meter` map to
  OpenTelemetry JS's tracer/meter; divergences: instruments resolve lazily (OTel JS instruments created
  before a provider is registered stay no-op, unlike .NET's `MeterListener`); `ActivityContext.TryParse`
  → a `SpanContext` built from the ported `parseTraceparent` (self-contained, no globally-set propagator
  needed; `tracestate` isn't threaded through); `Counter.Enabled` gating is dropped (OTel JS's no-op
  meter is already cheap); `benzene.status`/metric `result` values are the port's PascalCase status
  strings (`NotFound`, not .NET's `not-found`). `Benzene.OpenTelemetry` has no counterpart — OpenTelemetry
  JS exports every API tracer/meter once an SDK is registered, so there's no per-source `AddSource`/
  `AddMeter` step to port.
- HTTP routing (`@benzene/http`): `IHttpContext`, method+path routing via a `@httpEndpoint` decorator
  + `RouteFinder`/`UrlMatcher`, and the Benzene-status → HTTP-status-code mapping.
- Transport adapters (entry points) — the **complete event-source matrix for both clouds**, each
  over the ecosystem-native event types, each reaching a `@message`-decorated handler end-to-end (a
  real cloud event/request routes by topic through mapping → dispatch → response):
  - **AWS Lambda** (`@types/aws-lambda`): `aws-lambda-core` (unified entry point with the parsed-event
    router) + `sqs`, `sns`, `dynamodb`, `kinesis`, `s3`, `eventbridge`, `kafka` (queue/stream/
    notification sources) and `api-gateway` (HTTP request/response).
  - **Azure Functions** (`@azure/functions` + `@azure/service-bus` + `@azure/event-hubs`):
    `azure-function-core` (isolated-worker entry point) + `service-bus`, `event-hub`, `kafka` and
    `http` (the retargeted `AspNet` adapter — see ‡).
- Host/invocation layer: `IBenzeneApplicationBuilder`/`BenzeneApplicationBuilder`, `BenzeneInvocation`
  + `useBenzeneInvocation` (per-invocation correlation context). The `Microsoft.Extensions.Hosting`
  generic-host runners (`AwsLambdaHost`, host-builder extensions) and the registration-diagnostics
  surface remain deferred (each transport ships an `Inline*StartUp` on the first-party container).
- Outbound HTTP client (`@benzene/client-http` + `@benzene/clients` core): the client pipeline sends
  over the Node global `fetch` and maps the HTTP status back to a `BenzeneResult`, plus the full
  `Benzene.Clients` wrapper suite — retry, correlation-id and header-forwarding message-client
  decorators, their builders, and the client factory.
- Caching (`@benzene/cache-core` + `@benzene/cache-redis`§): the lazy-load `CacheEntry` abstraction
  and a Redis adapter over `ioredis`.
- Streaming engine (`@benzene/core-middleware` `Streaming/`): `StreamContext`,
  `StreamMiddlewareApplication`, the `StreamOperators`, `IStreamCheckpointer`, and `useStream`. C#
  `IAsyncEnumerable<T>` → `AsyncIterable<T>` / `async function*`.
- Health checks (`@benzene/health-checks-core` + `@benzene/health-checks` aggregator +
  `@benzene/health-checks-http` ping + `@benzene/health-checks-tcp` + `@benzene/health-checks-disk`):
  the `IHealthCheck` abstraction, aggregating runner, an HTTP-ping check over the global `fetch`, a
  TCP-connect check over `node:net`, and a free-disk-space check over `node:fs`'s `statfs`
  (`System.IO.DriveInfo` → `statfs`; `statfs` exposes no mount name, so the checked path stands in as
  the drive identifier). The TCP check's ambient `ICancellationTokenAccessor` DI seam is not ported
  yet, so its factory constructs the check with no `AbortSignal` (the constructor accepts one for when
  a scoped-signal accessor is ported).
- Contract-drift check (`@benzene/clients-health-checks`): the consumer side of the
  provider/consumer contract-hash comparison — `ClientHealthCheck` probes a downstream provider via its
  generated client (`IHasHealthCheck`) and reports reachable+matching as `ok`, reachable+drifted as
  `warning` (does not flip aggregate `isHealthy`), unreachable as `failed`; `ClientHealthCheckProcessor`
  annotates the provider's `schema` health check with the `ClientHashMatch` verdict; `addContractCheck`
  (client resolved from DI via its `ServiceIdentifier`, since the C# generic `AddContractCheck<TClient>`
  erases) / `addContractCheckInstance` register it on the contracts diagnostic topic. Ported
  `SchemaHealthCheckConstants` (the shared `schema`/`hashCode`/`match` keys) into `@benzene/health-checks-core`.
  DIVERGENCE: C# treats a `null` payload as "provider unreachable"; the port's `BenzeneResult` never
  yields a null payload (a failure result carries the `VoidResult` sentinel), so the check treats
  null/undefined OR that sentinel as "no payload". The C# package ships no test suite, so its tests here
  are new port-verification tests rather than ported C# scenarios.
- Serialization: three ecosystem-native adapter packages under the "adapted, not reimplemented"
  convention, each an `AcceptHeaderMediaFormatBase` format negotiated by `content-type`/`accept`
  alongside the built-in JSON — `@benzene/avro` (over `avsc`, keyed by request class, mirroring the
  schema-registry pattern the validation adapters use), `@benzene/messagepack` (over `@msgpack/msgpack`,
  schemaless like the C# contractless resolver), and `@benzene/xml` (over `fast-xml-parser`). The two
  binary formats implement `IPayloadSerializer`: the string path Base64-armors the binary so it flows
  through string-bodied transports, the byte path carries genuine binary. XML is text `ISerializer`
  only; erasure handling recovers the root element name from the payload's `constructor.name` (the C#
  `typeof(T).Name`) and returns a plain object on read. `Benzene.NewtonsoftJson` has no distinct JS
  analogue (there is one JSON) and is intentionally skipped.
- The strongly-typed `IMessageHandlerResult<TResponse>` / `MessageHandlerResult<TResponse>` variant
  (ported as `IMessageHandlerResultOf` / `MessageHandlerResultOf`, with the C# explicit
  typed→untyped conversion operator as a `toUntyped()` method).
- Extras (`@benzene/extras`): the assorted `Benzene.Extras` utilities — PATCH support (`IPatchMessage`
  / `PatchMessage` + `hasField` / `tryGet` / `set`, with C# expression trees mapped to typed property
  keys), the broadcast-event middleware (`BroadcastEventMiddleware` publishing `"<topic>d"` after a
  matching create/update/delete via an `IEventSender`), `ResponseBuilder`, `InlineMediaFormat`, and the
  `RawJsonMessage` / `Base64JsonMessage` result markers (their `IRawJsonMessage` / `IBase64JsonMessage`
  interfaces folded into `@benzene/abstractions`).
- Authentication & authorization (`@benzene/auth-core` + `@benzene/auth-basic`): the
  `AuthenticationHolder` scoped principal seam (Context Purity, like `PresetTopicHolder`), the
  `AuthResults` short-circuit helper (`Unauthorized`/`Forbidden` via the `IMessageHandlerResultSetter`
  idiom the health-check middleware uses), the mechanism-agnostic authorization layer (`requireRole` /
  `requirePolicy` / `requireAuthorization` + `IAuthorizationPolicy` / `IAuthorizationHandler` /
  `DelegateAuthorizationPolicy` / `addAuthorizationPolicy`, with the `role`/`roles` claim normalization
  including Azure AD's JSON-array app-roles shape), and RFC 7617 `useBasicAuth` (`BasicAuthMiddleware`
  + `IBasicAuthCredentialValidator`, first-colon password split, `WWW-Authenticate` challenge on every
  401). Two divergences specific to this slice:
  - **`System.Security.Claims` has no JS equivalent.** The .NET auth stack carries the caller as a BCL
    `ClaimsPrincipal` every JWT/OAuth2 library already produces; JavaScript has no such shared type, so
    the port re-creates the small slice the middleware actually reads (`Claim`, `ClaimsIdentity`,
    `ClaimsPrincipal`, `ClaimTypes`) inside `@benzene/auth-core` rather than inventing a
    Benzene-specific principal abstraction. BCL comparison semantics are preserved (claim-type match
    case-insensitive, value case-sensitive); unused `Claim` fields (`ValueType`/`Issuer`/…) are omitted.
  - **`BenzeneResult.unauthorized` / `.forbidden`.** The two status factories the C# `BenzeneResult`
    already exposes were added to the TypeScript `BenzeneResult` (no consumer had needed them before).
  - **C# integration tests → API Gateway host.** The C# suite hosts a real Kestrel `AspNetContext`
    pipeline over HTTP; with no ASP.NET host in the port, the ported tests reuse the API Gateway
    transport (a genuine `IHttpContext`) as the HTTP host, and — since the OAuth2 bearer adapter is
    seed the authenticated principal directly to exercise the authorization primitives, plus one
    end-to-end case composing real `useBasicAuth` with `requireRole`. (OAuth2 bearer is now ported —
    see the next bullet — so the OAuth2 authorization tests could equally run over real tokens.)
- OAuth2 bearer (`@benzene/auth-oauth2`): JWT bearer authentication and scope authorization —
  `useOAuth2Bearer` (`OAuth2BearerMiddleware` + `OAuth2BearerOptions` with fail-fast wire-up validation)
  and `requireScope` (`scope`/`scp` claim normalization, including Azure AD's JSON-array shape). This is
  the "adapted, not reimplemented" convention applied to auth: .NET's `Microsoft.IdentityModel`
  (`JsonWebTokenHandler` + `TokenValidationParameters` + a JWKS-caching `ConfigurationManager`) becomes
  an adapter over **`jose`**, the standard ecosystem JWT/JWKS library — `jwtVerify` + a
  `createRemoteJWKSet` key resolver. Divergences: the two C# retriever classes
  (`OpenIdConnectConfigurationRetriever` / `JwksOnlyConfigurationRetriever`) and the caching
  `ConfigurationManager` collapse into jose's native `createRemoteJWKSet` (so `JwksOnlyConfigurationRetriever`
  has no counterpart; the OIDC-discovery path is a thin lazy wrapper resolving `jwks_uri`); `ClockSkew`
  (`TimeSpan`) → `clockToleranceSeconds`; `RequireHttpsMetadata` enforced when the resolver is built; and
  `ILoggerFactory` → the port's `ILogger` (`NullLogger` fallback), still logging the real failure reason
  server-side only and never returning it to the caller. The security posture is preserved: an explicit
  algorithm allowlist (an HS256 token is rejected against an RS256-only allowlist — the algorithm-confusion
  guard) and mandatory issuer/audience/lifetime validation, all covered by the ported tests against a real
  loopback JWKS endpoint (`FakeJwksServer` over `node:http` + jose).
- Idempotency (`@benzene/idempotency`): at-least-once de-duplication — `useIdempotency` +
  `IdempotencyMiddleware` (claim → run-once → complete/release, releasing the claim when the handler
  throws or reports failure so a redelivery reprocesses), the pluggable `IIdempotencyStore` with an
  `InMemoryIdempotencyStore` default (lazy TTL expiry), the header-or-body-hash key strategy
  (case-insensitive header lookup, length-prefixed topic/body hashing so distinct triples can't collide
  through separator ambiguity), and the options/records/status/`InProgressBehavior` surface plus
  `addInMemoryIdempotencyStore`. Divergences: C# `CancellationToken` → an optional `AbortSignal`
  (`signal?.throwIfAborted()`), `SHA256`/`Convert.ToHexString` → `node:crypto` `createHash('sha256')`
  hex, `TimeSpan`/`DateTimeOffset` → epoch-millisecond `number`s with an injectable clock, and the
  store's `lock` is dropped (Node runs each method's synchronous body to completion, so the
  check-and-insert is already atomic). The `is IHasMessageResult` interface check → a `messageResult`
  duck-typing guard.
- Rate limiting (`@benzene/rate-limiting`): best-effort, per-instance protection — `useRateLimiting`
  (bring-your-own limiter + optional per-message permit cost), `useFixedWindowRateLimiting`,
  `useTokenBucketRateLimiting`, and `usePayloadSizeRateLimiting` (cost = the body's UTF-8 byte length
  via `Buffer.byteLength`), over `RateLimitingMiddleware` which acquires without queuing, short-circuits
  a rejected message with `TooManyRequests` (HTTP 429, attaching the looked-up handler definition so the
  error body is written), and holds the lease across `next()` so concurrency limiters release. Because
  Node has no `System.Threading.RateLimiting`, the used subset is re-created inside the package
  (`RateLimiter`/`RateLimitLease` + `FixedWindowRateLimiter`/`TokenBucketRateLimiter`/`ConcurrencyLimiter`):
  .NET's timer-driven `AutoReplenishment` becomes lazy, clock-driven replenishment over an injectable
  `now` (`TimeSpan` windows/periods → millisecond `number`s), and `AttemptAcquire`'s over-capacity
  `ArgumentOutOfRangeException` → a `RangeError` the middleware catches as a rejection. This is the first
  package to need `BenzeneResult.tooManyRequests`, added to `@benzene/results` to match the C# factory.
- Self-hosted workers (`@benzene/self-host`): the platform-neutral worker model — `WorkerApplicationBuilder`
  + `useWorker`, `BenzeneWorkerBuilder`/`IBenzeneWorkerStartup`, `CompositeBenzeneWorker` (materializes its
  deferred worker sequence exactly once, so stop targets the started instances), `InlineSelfHostedStartUp`,
  and `BoundedConcurrentDispatcher` — a per-lane, key-ordered, backpressured fan-out for a poll loop.
  Because Node has no `System.Threading.Channels`, the used subset is re-created in-package as a
  capacity-1 single-reader `BoundedChannel`; `Interlocked`/`Volatile` on the outstanding-count array
  become plain reads/writes (single-threaded event loop), `CancellationToken` → optional `AbortSignal`,
  `TimeSpan` timeouts → millisecond `number`s, and `ILogger` → `@benzene/abstractions`' `ILogger`.
  `IBenzeneWorkerStartup.Create(resolver)` is named `createWorker` to disambiguate from the generic
  pipeline-builder `create`. The 8 `Benzene.Abstractions.Pipelines` interfaces this package builds on were
  already ported (merged into `@benzene/abstractions`/`@benzene/abstractions-middleware`/`@benzene/clients`),
  and `Benzene.HostedService` (the .NET generic-host `IHostedService` adapter) has no JS counterpart — see
  the roadmap.
- Schema registry (`@benzene/schema-registry-core`): the vendor-neutral registry seam —
  `ISchemaRegistryClient` + `InMemorySchemaRegistryClient` (monotonic ids, per-subject versioning,
  idempotent re-registration), the `SchemaCompatibilityMode` evolution levels with a pluggable
  `ISchemaCompatibilityChecker` (`TextualSchemaCompatibilityChecker` default), `ConfluentWireFormat` (the
  `0x00` magic byte + big-endian schema-id framing, over `Uint8Array`/`DataView`), and
  `SchemaRegistrySerializer` + `SchemaRegistrar` that frame any inner `IPayloadSerializer`'s output with
  the registered id (wired up at startup). Erasure: C#'s runtime `Type` keys become `Constructor` keys
  (same as `@benzene/avro`) — the serialize path recovers the class from the payload's `constructor`, and
  the deserialize path threads an optional `targetType` to the inner serializer; the `IBufferWriter`
  `Encode` overload isn't ported (the port's `IPayloadSerializer` models `Uint8Array` directly), and the
  in-memory client's `lock` is dropped (single-threaded event loop makes check-and-insert atomic).
- Configuration / secrets (`@benzene/configuration-core`): the `ISecretStore` "fetch a named value"
  seam with the full set of runtime-only stores — `InMemorySecretStore`, `EnvironmentVariableSecretStore`
  (logical-name → `DB_PASSWORD` mapping), `FileSecretStore` (the Docker/Kubernetes secret-mount
  convention), `CompositeSecretStore` (first-non-undefined layering) and `CachingSecretStore` (TTL cache
  with `invalidate`/`invalidateAll`) — plus `SecretResolver` (typed, fail-fast `requireAsync`/`getAsync`/
  `requireInt`/`requireBool`/`requireUri`), `SecretValidation.ensureRequiredAsync` (startup completeness
  check listing every missing name at once), and the `addSecretStore(s)` registration functions.
  Divergences: `CancellationToken` → optional `AbortSignal`, `TimeSpan`/`DateTimeOffset` → millisecond
  `number`s with an injectable clock, `System.IO.File` → `node:fs/promises` (missing file → the caught
  `ENOENT`), `Environment.GetEnvironmentVariable` → `process.env`, `FormatException` → `Error`, and `Uri`
  → the WHATWG `URL`.
- Sagas (`@benzene/saga`): the in-code distributed-transaction orchestrator — `SagaBuilder` /
  `StageBuilder` / `StepBuilder` (ordered stages of concurrently-run steps), the `Saga` engine
  (thread each stage's results forward, and on a stage failure compensate every completed effect
  newest-first, leaving the system at its starting state), `SagaResult`/`SagaOutcome`/`SagaStepState`,
  the optional whole-saga `SagaRetryPolicy` (retry a *clean* rollback with exponential backoff; never
  retry a success or a partial rollback), and the pluggable `ISagaStateStore` with an
  `InMemorySagaStateStore` default. Divergences: `Task.WhenAll` → `Promise.all`, `TimeSpan` → millisecond
  `number`s with an injectable delay, `Guid.NewGuid()` → `crypto.randomUUID()`, `CancellationToken` →
  optional `AbortSignal`, and — the notable one — **`SagaContext` keys strictly by explicit string key**.
  The .NET context keys published step-results by their reified type (`typeof(T).FullName`) with an
  optional string override; TypeScript erases generics and `get<T>()` has no instance to fall back to, so
  the type-as-default-key can't be ported. A step publishes only when it declares a key
  (`StepBuilder.key`), and a later stage reads it by that same key (`ctx.get<T>(key)`).
- Response events (`@benzene/response-events`): republishing a handler's response as a follow-up event
  — the mapping rules (`ExplicitResponseEventMapping` with `when`/projector, `CrudConventionResponseEventMapping`
  for `X:create` → `X:created`), `ResponseEventMappings` (fan-out; every matching mapping publishes),
  the `ResponseEventsMiddleware` handler-middleware (publish-on-success via `IResponseEventPublisher`,
  with `FailMessage` vs `LogAndContinue` failure modes) + its `useResponseEvents` router registration,
  the introspection surface (`IResponseEventCatalog` aggregating every pipeline's mappings, an
  `IMessageDefinitionFinder` for spec generation, `ResponseEventDefinition`/`ResponseEventDeclarations`),
  and the `findUnmappedResponseHandlers`/`logUnmappedResponseHandlers` startup diagnostic. Divergences:
  C#'s `Map<TPayload>` (which reads `typeof(TPayload)`) becomes `mapWithPayload(payloadType, …)` with an
  explicit constructor, since generics erase; the "no payload" check also treats the `VoidResult`
  sentinel as empty (what `BenzeneResult.accepted<T>()` carries in the port). The default publisher
  `BenzeneMessageSenderResponseEventPublisher` (over the outbound-routing `IBenzeneMessageSender` — see
  below) is registered by `useResponseEvents`, and the end-to-end chain (middleware → default publisher →
  outbound route) is covered by a test.
- Outbound routing (`@benzene/clients`): the topic-addressed `IBenzeneMessageSender` surface —
  `addOutboundRouting(routing => routing.route(topic, pipeline => …))` builds one outbound
  `IMiddlewarePipeline<OutboundContext>` per topic ahead of time (`OutboundRoutingBuilder`,
  `OutboundRoutingTopics`), and `DefaultBenzeneMessageSender.sendAsync(topic, request, headers?)` runs the
  matching route, with `UnroutedTopicException` / `DuplicateOutboundRouteException` /
  `OutboundResponseTypeMismatchException`. Erasure divergence: `sendAsync<TRequest, TResponse>` can't
  compare the produced payload type against the erased `TResponse` (the .NET `is IBenzeneResult<TResponse>`
  check), so it returns the route's result cast to `TResponse` and only throws the mismatch exception for
  the coarser case it *can* detect — a route that produced no `IBenzeneResult` at all. `useParallel` fans a
  single topic out to several transports concurrently (all-must-succeed aggregate), over the new
  `BoundedFanOut` primitive in `@benzene/core-middleware` (`Task.WhenAll` + `SemaphoreSlim` → `Promise.all`
  + an async semaphore, results in source order). The outbound `useW3CTraceContext`
  (`Benzene.Clients.TraceContext`) stamps the active span's `traceparent`/`tracestate` onto an outbound
  route's headers (built from `trace.getActiveSpan()`'s span context — the outbound counterpart of
  `@benzene/diagnostics`' inbound `useW3CTraceContext`). Still deferred: `validateOutboundRouting` (assembly
  reflection over `Benzene.CodeGen.Client` generated-client contracts).

Next, in dependency order, following the .NET repository:

0. `validateOutboundRouting` — startup validation of a generated client's required topics; needs
   `Benzene.CodeGen.Client` and assembly reflection, neither ported. (The rest of the outbound-routing
   surface — `IBenzeneMessageSender` + `addOutboundRouting` + `useParallel` + the outbound
   `useW3CTraceContext` — is ported.)

   Note: a shared `IIdempotencyStore` adapter (Redis/DynamoDB) is intentionally **not** on this list —
   the .NET repo ships no such package (it's a copy-paste example in `docs/cookbooks/idempotency.md`), so
   porting one would invent a package with no C# counterpart. `InMemoryIdempotencyStore` remains the only
   shipped store, matching the original.
2. Mesh/schema tooling — the sender-definition building blocks (`IMessageSenderDefinition` /
   `MessageSenderDefinition`, the `IMessageDefinitionFinder` token) are ported; the remaining
   `Benzene.Mesh.*` catalog/topology/contract-drift surface and schema generation
   (`Benzene.JsonSchema` / `Benzene.Schema.OpenApi`) build on them.
3. Host runners — the platform-neutral worker model (`Benzene.SelfHost`: worker builder + composite +
   `BoundedConcurrentDispatcher`) is ported as `@benzene/self-host`; the remaining `Microsoft.Extensions
   .Hosting` generic-host adapter (`Benzene.HostedService`) has no JS counterpart, and an HTTP host
   entrypoint is held for a design decision on the Node HTTP host shape. Third cloud
   (`Benzene.GoogleCloud.Functions`) is a straightforward extension of the Azure Functions port when the
   two-cloud scope widens.

## License

MIT — same as the .NET original.

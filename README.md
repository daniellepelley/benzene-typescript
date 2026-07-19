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

† .NET's validation integrations wrap .NET-only libraries (`Benzene.DataAnnotations` →
`System.ComponentModel.DataAnnotations`, `Benzene.FluentValidation` → FluentValidation). Per the
"Third-party library integrations" convention, these are re-created as adapters over the popular
JavaScript validation libraries (Zod, Joi, Yup) rather than ported literally; all three mirror the
`Benzene.FluentValidation` integration shape.

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
- Diagnostics (partial): `TimerMiddleware` and the debug-middleware decorator/wrapper + `useTimer`.
  C# `Stopwatch` → `Date.now()` deltas; `Debug.WriteLine` → an injectable, silent-by-default sink.
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
  over the Node global `fetch` and maps the HTTP status back to a `BenzeneResult`. The broader
  `Benzene.Clients` wrapper suite (retry/correlation/trace message clients) is deferred.
- Caching (`@benzene/cache-core` + `@benzene/cache-redis`§): the lazy-load `CacheEntry` abstraction
  and a Redis adapter over `ioredis`.

Next, in dependency order, following the .NET repository:

1. The streaming engine (`StreamMiddlewareApplication`/`StreamContext`/`useStream`) — deferred by the
   Kinesis and Event Hub adapters, which currently use per-record fan-out; porting it lets those take
   their true streaming shape.
2. Health checks (`Benzene.HealthChecks`) — unblocks the deferred cache/API-Gateway health-check
   extensions.
3. The distributed-tracing / metrics surface deferred from Diagnostics (`ActivityMiddleware`, W3C
   trace context, correlation ids, metrics, process timers) — needs a Node tracing abstraction; the
   deferred `Benzene.Clients` correlation/trace wrappers depend on it.
4. Mesh/schema tooling (`MessageSenderDefinition` + finders), the generic `IMessageHandlerResult<T>`
   variant, an Avro serializer adapter, and the `Microsoft.Extensions.Hosting` generic-host runners.

## License

MIT — same as the .NET original.

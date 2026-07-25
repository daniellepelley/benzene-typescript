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
- `examples/` — runnable example apps: `mesh-service` (a live mesh-discoverable Express service),
  `aws-lambda-functions` (one domain on five AWS Lambda transports), `azure-functions` (the same domain
  on three Azure Functions triggers) — each driven end-to-end by a CI test
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
| `src/Benzene.Express` | `@benzene/express` | *(no C# counterpart — Express host adapter, analog of `Benzene.AspNet.Core`)* |
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
| `src/Benzene.Clients.Aws.Lambda` | `@benzene/clients-aws-lambda` | `Benzene.Clients.Aws.Lambda` (low-level client; message-client/pipeline/health-check deferred) |
| `src/Benzene.Mesh.Aws.Lambda` | `@benzene/mesh-aws-lambda` | `Benzene.Mesh.Aws.Lambda` |
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
| `src/Benzene.Core.Versioning` | `@benzene/core-versioning` | `Benzene.Core.Versioning` (explicit casters; auto-mapper not ported) |
| `src/Benzene.Mesh.Contracts` | `@benzene/mesh-contracts` | `Benzene.Mesh.Contracts` |
| `src/Benzene.Mesh.Dispatch` | `@benzene/mesh-dispatch` | `Benzene.Mesh.Dispatch` |
| `src/Benzene.Mesh.Reporting` | `@benzene/mesh-reporting` | `Benzene.Mesh.Reporting` |
| `src/Benzene.Mesh.Aggregator` | `@benzene/mesh-aggregator` | `Benzene.Mesh.Aggregator` |
| `src/Benzene.Mesh.Tracing.Tempo` | `@benzene/mesh-tracing-tempo` | `Benzene.Mesh.Tracing.Tempo` |
| `src/Benzene.Mesh.Azure.Blob` | `@benzene/mesh-azure-blob` | `Benzene.Mesh.Azure.Blob` |
| `src/Benzene.Mesh.Discovery.Azure` | `@benzene/mesh-discovery-azure` | `Benzene.Mesh.Discovery.Azure` |
| `src/Benzene.Mesh.Usage.ApplicationInsights` | `@benzene/mesh-usage-application-insights` | `Benzene.Mesh.Usage.ApplicationInsights` |
| `src/Benzene.Mesh.Aws.S3` | `@benzene/mesh-aws-s3` | `Benzene.Mesh.Aws.S3` |
| `src/Benzene.Mesh.Discovery.Aws` | `@benzene/mesh-discovery-aws` | `Benzene.Mesh.Discovery.Aws` |
| `src/Benzene.Mesh.Usage.CloudWatch` | `@benzene/mesh-usage-cloudwatch` | `Benzene.Mesh.Usage.CloudWatch` |
| `src/Benzene.Mesh.Discovery.Kubernetes` | `@benzene/mesh-discovery-kubernetes` | `Benzene.Mesh.Discovery.Kubernetes` |
| `src/Benzene.Mesh.Wire` | `@benzene/mesh-wire` | `Benzene.Mesh.Wire`† |
| `src/Benzene.CodeGen.Client` | `@benzene/codegen-client` | `Benzene.CodeGen.Client`§§ |
| `src/Benzene.Testing` | `@benzene/testing` | `Benzene.Testing`¶ |
| `src/Benzene.Aws.Lambda.TestHelpers` | `@benzene/aws-lambda-testing` | `Benzene.Aws.Lambda.*.TestHelpers`¶ |
| `src/Benzene.CloudService.Probe` | `@benzene/cloud-service-probe` | `Benzene.CloudService.Probe` |
| `src/Benzene.Configuration.Core` | `@benzene/configuration-core` | `Benzene.Configuration.Core` |
| `src/Benzene.Saga` | `@benzene/saga` | `Benzene.Saga` |
| `src/Benzene.ResponseEvents` | `@benzene/response-events` | `Benzene.ResponseEvents` |
| `src/Benzene.Dependencies` | `@benzene/dependencies` | `Benzene.Microsoft.Dependencies`* |
| `test/Benzene.Core.Test` | `@benzene/core-test` (private) | `Benzene.Core.Test` |

\* Node has no platform DI container equivalent to `Microsoft.Extensions.DependencyInjection`,
so `@benzene/dependencies` ships a first-party `ServiceCollection` /
`DefaultBenzeneServiceContainer` / `DefaultServiceResolverFactory` with the same
singleton/scoped/transient semantics.

† `@benzene/mesh-wire` ports both wire feeds of `Benzene.Mesh.Wire`. The **ServiceDescriptor path**
(`mesh.md` §2): the descriptor types, `MeshDescriptorFactory` + §2.2 `descriptorHash`, the pluggable
`IMeshSchemaProvider` (replacing C#'s CLR-reflection schema generator — TypeScript erases the
request/response types), and `useMeshDescriptor`; `runtime` is `"node"`. And the **trace feed** (§3):
`MeshTraceEvent` / `MeshTraceBatch` / `MeshHeartbeat`, the ambient `MeshSpan` (over `AsyncLocalStorage`),
the `Traceparent` parser, `IMeshStatusReader`, the lossy `HttpMeshTraceExporter`, and `useMeshTrace`. Two
adaptations are documented in "Multi-language interoperability": C#'s reflection schema generator →
injected schema provider, and C#'s `System.Threading.Channels` exporter pump → a bounded buffer + timer
loop with a fire-and-forget sync `dispose()`.

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

¶ **Testing helpers.** `@benzene/testing` ports `Benzene.Testing`'s platform-neutral request builders
(`messageBuilder`/`httpBuilder` + `asBenzeneMessage`/`asRawHttpRequest`); the C# static `MessageBuilder.
Create`/`HttpBuilder.Create` factories become free functions, and the required `ISerializer` becomes an
optional argument defaulting to JSON. `@benzene/aws-lambda-testing` provides the transport test-event
builders (`asApiGatewayRequest`, `asSqs`, `asSns`, `asEventBridge`, `asAwsKafkaEvent`) that turn one
builder into a native cloud event routable by the matching adapter. **Two deliberate TS-DX bends,** both
from the TypeScript-DX-champion lens (see `.claude/agents/typescript-dx-champion.md`): (1) the C# ships one
`*.TestHelpers` project per transport to isolate each `Amazon.Lambda.*Events` NuGet, but in Node every
Lambda event type comes from the single `@types/aws-lambda`, so there is no dependency to isolate — the
idiomatic shape is one `@benzene/aws-lambda-testing` package with a builder per transport; (2) C#'s
positional/overloaded `As*(serializer, numberOfMessages)` parameters become a single trailing **options
object** (`{ serializer?, numberOfMessages? }`), consistent across every builder. Not ported yet: the
`BenzeneTestHost`/`BenzeneTestHostBuilder` startup-host (the TS transports are driven directly via their
`*Application`/`InlineAwsLambdaStartUp` entry points, which the ported tests already use), and the DynamoDB
Streams (needs AttributeValue marshalling), Kinesis, and S3 builders — see the package `index.ts` notes.

§§ `@benzene/codegen-client` realizes `Benzene.CodeGen.Client`'s **client SDK generator**, pivoted
from CLR reflection to **JSON Schema** — see "Code generation" below. The .NET generator derives client
types by reflecting over the service's CLR request/response types, which cannot cross a language
boundary; this port generates the client from the service's mesh **ServiceDescriptor** (`mesh.md` §2),
whose per-topic schemas are language-neutral JSON Schema (§2.1). So a C# service's descriptor and a
TypeScript service's descriptor generate an identical, fully typed client. A bespoke emitter covers the
§2.1 subset (keeping the zero-runtime-deps rule; `json-schema-to-typescript` is the drop-in for arbitrary
schemas). Not ported: the reflection/OpenAPI-document plumbing (`Benzene.CodeGen.Core`,
`Benzene.Schema.OpenApi`, `Microsoft.OpenApi`), the C#-target type builder, and the generated health-check/
hash/outbound-routing-contract extras, which are .NET-client-infrastructure specific.

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

You write a **message handler once** and host it anywhere. A handler declares its topic with
`@message` (and, for HTTP, its route with `@httpEndpoint`):

```ts
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { BenzeneResult } from '@benzene/results';

class CreateOrder { customerId?: string; }
class OrderCreated { orderId?: string; }

@httpEndpoint('POST', '/orders')
@message('order:create', { requestType: CreateOrder, responseType: OrderCreated })
export class CreateOrderHandler implements IMessageHandler<CreateOrder, OrderCreated> {
  handleAsync(request: CreateOrder): Promise<IBenzeneResultOf<OrderCreated>> {
    const payload = new OrderCreated();
    payload.orderId = `order-${request.customerId ?? 'anon'}`;
    return Promise.resolve(BenzeneResult.created(payload));
  }
}
```

Host it **in-process** (Express — the runnable [`examples/mesh-service`](examples/mesh-service) is
exactly this shape; start it with `npm start -w @benzene-example/mesh-service`):

```ts
import express from 'express';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { benzene } from '@benzene/express';

const app = express();
app.use(benzene((pipeline) => useMessageHandlers(pipeline, CreateOrderHandler)));
app.listen(3000);
```

…or host the **same handler** on **AWS Lambda** — `toLambdaHandler` returns the `handler` AWS
invokes (use it rather than assigning the method, which would detach `this`):

```ts
import { addBenzene, useMessageHandlers } from '@benzene/core-message-handlers';
import { InlineAwsLambdaStartUp, toLambdaHandler } from '@benzene/aws-lambda-core';
import { useApiGateway } from '@benzene/aws-lambda-api-gateway';

const entryPoint = new InlineAwsLambdaStartUp()
  .configureServices((services) => addBenzene(services))
  .configure((app) => useApiGateway(app, (api) => useMessageHandlers(api, CreateOrderHandler)))
  .build();

export const handler = toLambdaHandler(entryPoint);
```

The same handler runs on every transport of both clouds — see
[`examples/aws-lambda-functions`](examples/aws-lambda-functions) (one domain on API Gateway, SQS, SNS,
EventBridge, and Kafka) and [`examples/azure-functions`](examples/azure-functions) (the same domain on
HTTP, Service Bus, and Event Hub).

<details><summary>Under the hood: driving a pipeline directly (what the hosts build on)</summary>

```ts
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';

const container = new DefaultBenzeneServiceContainer();
const builder = new MiddlewarePipelineBuilder<MyContext>(container); // MyContext = your transport context
builder
  .useExceptionHandler((context, error) => { /* map error onto context */ })
  .useFn('Auth', async (context, next) => { /* before */ await next(); /* after */ })
  .onResponse((context) => { /* inspect result */ });

const pipeline = builder.build();
const resolver = container.createServiceResolverFactory().createScope();
try {
  await pipeline.handleAsync(myContext, resolver);
} finally {
  resolver.dispose();
}
```

</details>

## Porting conventions

Rules applied consistently across the port, chosen to keep TypeScript code recognizable
next to its C# counterpart:

- **Names.** Type and file names are identical to C# (including the `I` interface prefix);
  methods and properties become camelCase (`HandleAsync` → `handleAsync`). The `Async` suffix
  is kept. One deliberate rename: `IDeferredRequestMapper`/`DeferredRequestMapper` →
  `IRequestMapperThunk`/`RequestMapperThunk` — a zero-arg deferred producer is idiomatically a
  "thunk" in TypeScript; same shape, TS-native spelling.
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
  `resolver.getServices(token)`. Because TypeScript erases parameter types (there is no reflective
  constructor injection), a class registered with constructor parameters but no `inject` array can't
  be resolved — the container detects this via `Function.length` and throws a teaching error naming
  the fix, rather than silently constructing with zero arguments.
- **Extension methods.** TypeScript has none. Fluent pipeline-builder extensions
  (`Use`, `OnRequest`, `OnResponse`, `Split`, `Convert`, `UseExceptionHandler`,
  `UseLogResult`, ...) become interface members implemented once in
  `MiddlewarePipelineBuilderBase`; non-fluent extensions (`TryAddSingleton`,
  `AddBenzeneMiddleware`, ...) become free functions in a file named after the C# extensions
  class. A fluent extension can only become a builder *member* when it lives in the builder's own
  package: fluent extensions defined **downstream** (e.g. `@benzene/core-message-handlers`'s
  `useMessageHandlers`/`usePresetTopic`, which would create a layering cycle if added to
  `IMiddlewarePipelineBuilder` upstream) instead become **free functions taking the builder as their
  first argument** (`useMessageHandlers(app, …)`) and return it, so they still chain at their own call
  site — hence `benzene((pipeline) => useMessageHandlers(pipeline, …))` rather than a `.useMessageHandlers`
  method.
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
- **Ambient state & concurrency primitives.** `AsyncLocal<T>` → Node's `AsyncLocalStorage` (a C#
  settable `Current` with a `finally` restore becomes `als.run(value, () => next())`, whose scope
  reverts automatically). `CancellationToken` → an optional `AbortSignal`. `SemaphoreSlim` → a
  promise-chain mutex, and `Task.WhenAll` → `Promise.all` (bounded fan-out via `@benzene/core-middleware`'s
  `BoundedFanOut`). `System.Threading.Channels` has no Node built-in: the used subset is re-created
  in-package — a capacity-bounded buffer drained by a single re-entrancy-guarded loop (kicked by size and
  by an `unref`'d `setInterval`). Because JavaScript can't block a thread on a promise, a C# synchronous
  `Dispose` that bridges to async work becomes a fire-and-forget `dispose()` alongside a `disposeAsync()`
  that callers `await` when they need the work to complete.
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

## Multi-language interoperability

The point of the port is that a TypeScript Benzene service and a .NET Benzene service can run in **one
mesh** and call each other — the runtime language is invisible on the wire. Everything that crosses a
process boundary is a language-neutral contract (`docs/specification/wire-contracts.md` and `mesh.md` in the
.NET repo): the message envelope (`{ topic, headers, body }`), the response envelope + error payload, the
**status vocabulary**, the health document, and the mesh `spec` descriptor. The port holds these
byte-identical to .NET so the two interoperate:

- **Status vocabulary.** `BenzeneResultStatus`'s string values are the normative lowercase-kebab wire
  statuses (`ok`, `not-found`, `validation-error`), case-sensitive, identical to the .NET constants — so a
  status a TypeScript service writes as the response `statusCode` classifies identically in a .NET peer (and
  vice versa), and a metrics-derived mesh usage feed itemizes failures the same across languages. (Everything
  in the port refers to these via the `BenzeneResultStatus` constants, so the wire values are defined once.)
- **Mesh aggregation across languages.** The ported `MeshAggregator` interrogates any service's `spec`/`health`
  endpoints over HTTP regardless of the implementing language, builds the cross-service topic catalog and
  structural topology from what each service self-describes, and so links a producer in one language to a
  consumer in another. `test/Benzene.Core.Test/MultiLanguage/CrossLanguageMeshTest.test.ts` demonstrates this
  end-to-end: two real `node:http` services (one standing in for a .NET runtime, one for TypeScript — the
  fixtures are exactly what each language's Benzene runtime serves) are polled by the real aggregator over the
  real global `fetch`, and it derives a cross-language topology edge from the .NET producer to the TypeScript
  consumer.
- **A live, mesh-discoverable TypeScript service.** `examples/mesh-service` is a runnable Benzene HTTP service
  (Express-hosted handlers) that serves `/benzene/spec` (a descriptor derived from its handler registry) and
  `/benzene/health` — the language-neutral endpoints a mesh aggregator interrogates. Start it
  (`npm start -w @benzene-example/mesh-service`) and point either the TypeScript `MeshAggregator` or the .NET
  `Benzene.Mesh.Aggregator` at it; both catalog it with no knowledge that it's TypeScript.
  `test/Benzene.Core.Test/MultiLanguage/RunnableServiceMeshTest.test.ts` starts this very service and drives
  the real aggregator against it in CI.
- **The normative descriptor path.** The reserved `mesh` topic → `ServiceDescriptor` contract
  (`mesh.md` §2, the shape `Benzene.Mesh.Wire`/`Benzene.Mesh.Collector` use for the live .NET↔Go
  cross-language fleets) is ported as `@benzene/mesh-wire`: `MeshServiceDescriptor` and friends,
  `MeshDescriptorFactory.create` (topic list derived from the running `IMessageHandlerDefinitionLookUp`,
  sorted by id then version), the §2.2 `descriptorHash` (`node:crypto` SHA-256 over the spec's canonical
  JSON — fixed descriptor field order, lexicographic schema-map keys, `instanceId`/`degraded`/`profile`
  blanked), and `useMeshDescriptor`, which intercepts the reserved topic and short-circuits with the
  descriptor. `runtime` is `"node"` (the C# original's `"dotnet"`); per §2.2 the hash is per-port by design
  and never compared across ports, so this difference is expected. The one divergence: C# derives each
  topic's request/response JSON Schema (§2.1) by *reflecting* over the handler's CLR types, which
  TypeScript's erased types can't do, so the port injects a pluggable **`IMeshSchemaProvider`** keyed by
  topic (`NoMeshSchemaProvider` / `MapMeshSchemaProvider`) — the schema moves from CLR reflection to an
  explicit source (a schema registry, a `@benzene/zod`/`joi`/`yup` model, or a hand-written map); the §2.1
  mapping table itself is normative and unchanged. `docs/specification/conformance/mesh-descriptor-cases.json`
  is ported to `test/Benzene.Core.Test/Conformance/` and pins the derived descriptor + hash properties;
  `examples/mesh-service` serves its normative descriptor at `/benzene/descriptor`
  (`test/Benzene.Core.Test/MultiLanguage/RunnableServiceMeshTest.test.ts` reads it live).
- **The mesh trace feed** (`mesh.md` §3) is also ported in `@benzene/mesh-wire`: `MeshTraceEvent` /
  `MeshTraceBatch` / `MeshHeartbeat`, the ambient `MeshSpan` (W3C trace-context propagation over Node's
  `AsyncLocalStorage`, the port of C#'s `AsyncLocal`), the package-local `Traceparent` parser (join/reject
  per §3), the per-transport `IMeshStatusReader` (+ `BenzeneMessageMeshStatusReader`), the lossy batching
  `HttpMeshTraceExporter` (C#'s `System.Threading.Channels` pump → a bounded buffer drained by an
  `unref`'d timer loop; JS can't block a thread on a promise, so the C# synchronous `Dispose` bridge
  becomes a fire-and-forget `dispose()`, with `disposeAsync()` for a guaranteed tail flush), and the
  `useMeshTrace` middleware. `docs/specification/conformance/mesh-trace-cases.json` is ported and pins the
  traceparent rules and the invocation → semantic-status mapping (including a handler exception traced as
  `service-unavailable`). Not yet ported from `Benzene.Mesh.Wire`: nothing — but the collector side that
  consumes these feeds (`Benzene.Mesh.Collector`) is a separate package, not yet ported.
- **Code generation from JSON Schema.** `@benzene/codegen-client` closes the loop: it turns a service's
  ServiceDescriptor — whose per-topic `requestSchema`/`responseSchema` are language-neutral JSON Schema
  (§2.1) — into a fully typed TypeScript client (a payload interface per request/response, plus a
  `<Service>ServiceClient` calling `IBenzeneMessageSender.sendAsync`). Because the input is the JSON
  schemas rather than any runtime's types, a **C# service's descriptor generates the same client a
  TypeScript service's does** — a client for a service in any language, derived purely from the contract.
  This is the deliberate answer to porting `Benzene.CodeGen.*` (which generates by CLR reflection): route
  everything through JSON Schema and the type-building becomes multi-language by construction.
  `test/Benzene.Core.Test/CodeGen/GeneratedClientRoundTripTest.test.ts` regenerates the committed client
  from `examples/mesh-service`'s live descriptor (asserting byte-for-byte match, so the checked-in client
  `tsc` compiles is exactly what the generator emits) and exercises it over a fake sender.

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
  (client side). The registries bind the schema's static type to the request class
  (`register<T>(requestType: Constructor<T>, schema: ZodType<T>/Schema<T>)`), so registering a schema
  for an unrelated shape is a compile error — recovering the compile-time link FluentValidation's
  `IValidator<TRequest>` gave for free. This is the "third-party integrations are adapted, not
  reimplemented" convention in action — .NET's `Benzene.DataAnnotations` / `Benzene.FluentValidation`
  (both wrapping .NET-only libraries) become adapters over the popular JS validation libraries instead.
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
  meter is already cheap); `benzene.status`/metric `result` values are the framework status strings from
  `BenzeneResultStatus` — the normative lowercase-kebab wire vocabulary (`not-found`), identical to .NET, so
  a metrics-derived mesh usage feed classifies the same across languages. `Benzene.OpenTelemetry` has no counterpart — OpenTelemetry
  JS exports every API tracer/meter once an SDK is registered, so there's no per-source `AddSource`/
  `AddMeter` step to port.
- HTTP routing (`@benzene/http`): `IHttpContext`, method+path routing via a `@httpEndpoint` decorator
  + `RouteFinder`/`UrlMatcher`, and the Benzene-status → HTTP-status-code mapping.
- Transport adapters (entry points) — the **complete event-source matrix for both clouds**, each
  over the ecosystem-native event types, each reaching a `@message`-decorated handler end-to-end (a
  real cloud event/request routes by topic through mapping → dispatch → response):
  - **AWS Lambda** (`@types/aws-lambda`): `aws-lambda-core` (unified entry point with the parsed-event
    router) + `sqs`, `sns`, `dynamodb`, `kinesis`, `s3`, `eventbridge`, `kafka` (queue/stream/
    notification sources) and `api-gateway` (HTTP request/response). AWS invokes an exported `handler`
    function, so `toLambdaHandler(entryPoint)` returns the correctly-bound handler for
    `export const handler = toLambdaHandler(entryPoint)` — the shape a TS Lambda developer expects (the
    naive `= entryPoint.functionHandlerAsync` compiles but detaches `this`). `api-gateway` ports the v1
    (REST API, payload format 1.0) adapter; the v2 (HTTP API, payload format 2.0) and Custom Authorizer
    sub-applications are **not yet ported**.
  - **Azure Functions** (`@azure/functions` + `@azure/service-bus` + `@azure/event-hubs`):
    `azure-function-core` (isolated-worker entry point) + `service-bus`, `event-hub`, `kafka` and
    `http` (the retargeted `AspNet` adapter — see ‡). Dispatch to an entry point is **arity-only**
    (response vs fire-and-forget) rather than C#'s runtime type match: erasure removes `TRequest`/
    `TResponse`, and the optional `name` discriminator is dropped, so a host registers at most one
    response and one fire-and-forget entry point (the normal case). A missing entry point throws a
    self-diagnosing error naming what is registered and the `use*()` to wire.
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
- Payload version-casting (`@benzene/core-versioning`): transparent request-upcast / response-downcast so
  one handler on the canonical schema serves older-version producers — the `ICaster`/`FuncCaster`/
  `CompositeCaster` core, the schema layer (`ISchemaCaster`/`SchemaCaster`/`SchemaCasters` + builders),
  `SchemaCastDefinitionsExpander` (BFS shortest-path chain composition, preferring a registered shortcut),
  the `CastingRequestMapper`/`CastingResponsePayloadMapper` decorators, and `usePayloadVersionCasting` +
  `registerSchemaCastDefinitions`/`registerPayloadSchemaVersions`. Also ported the version-getter
  infrastructure it needs: `IMessageVersionGetter`, `MessageVersionHeaders` (`benzene-version`),
  `HeaderMessageVersionGetter` + `addHeaderMessageVersionGetter` (wired into `addBenzeneMessage`).
  **Major divergence:** C#'s default caster is a reflection + `System.Linq.Expressions` auto-mapper
  (`CasterFactory`/`CasterFuncBuilder`/`SchemaTypeMatcher`) that maps properties by name at runtime — it
  has no faithful TS equivalent (no runtime property reflection, no IL compilation, no assembly scanning),
  so it is **not ported**; casters are explicit `(from) => to` functions (idiomatic TS anyway), so the C#
  `CasterFactoryTest` is not ported either. Runtime `Type` keys → `Constructor` keys throughout; the
  request path needs the target type `getBody<TRequest>` can't convey under erasure, so an optional
  `targetType` was threaded through `IRequestMapper.getBody`/`RequestMapperThunk`/`MessageRouter` (the
  same optional-`targetType` erasure pattern `@benzene/avro` uses; existing mappers ignore it). A
  failure/no-payload result carries the `VoidResult` sentinel, so the response mapper treats that (and a
  raw-string payload) as "no downcast", matching the C# `payload == null` guard.
- Cloud Service conformance probe (`@benzene/cloud-service-probe`): a self-contained (no Benzene package
  deps) external, black-box HTTP probe of the Cloud Service Profile — `CloudServiceProbe.runAsync` hits a
  live service's `/benzene/health`, `/benzene/invoke`, `/benzene/spec` and reserved `mesh` topic and returns
  a tri-state (`Satisfied`/`NotSatisfied`/`Inconclusive`) assessment of R1–R8 built only from what it
  observed, never trusting the service's own claims. `HttpClient` + `BaseAddress` → an injectable `fetch`
  (`@benzene/health-checks-http`'s adaptation) + `baseUrl`; `System.Text.Json.Nodes` shape checks →
  `JSON.parse` + type guards; `RandomNumberGenerator` → Web-Crypto `getRandomValues` for the synthetic
  W3C `traceparent`. The 7-case unit test runs against a real `node:http` loopback server (mirroring the
  C# `HttpListener` approach); the C# integration test isn't ported (it wires a full `Benzene.AspNet.Core`
  + `Benzene.CloudService` host, neither of which is ported yet).
- Express host adapter (`@benzene/express`) — **no C# counterpart to port.** `Benzene.AspNet.Core` is
  ASP.NET Core-specific; Express is the Node/JS host equivalent, so this is a new adapter built to the same
  *shape* (added under the "third-party integrations are adapted, not reimplemented" convention — Express
  plays the role ASP.NET Core plays in .NET). `benzene((pipeline) => useMessageHandlers(pipeline, ...))`
  returns a standard Express/Connect `(req, res, next)` middleware for the **strangler-fig pattern**:
  Benzene handles the HTTP verbs + URLs it has `@httpEndpoint` handlers for, and falls through to the rest
  of the Express app for everything else. The fallback mirrors `Benzene.AspNet.Core`'s
  `if (!Response.HasStarted) next()`, realized explicitly via `IRouteFinder` — the middleware checks the
  route table first and calls `next()` *without reading the request body* when no route matches, so
  downstream middleware sees an untouched request. The adapter set (context, getters, request/response
  adapters, enricher, result setter, `addExpress`) is a structural analog of
  `@benzene/aws-lambda-api-gateway`'s. Typed against Node's `http` (`IncomingMessage`/`ServerResponse`)
  with no runtime `express` dependency (Express is an optional peer); the raw body is read up front
  (ASP.NET's `UseBufferedRequestBody` equivalent), so mount it before any body parser. Tested end-to-end
  against a real Express 5 app. Known limitation (port-wide, not Express-specific): a bodyless request
  (GET) yields `{} as TRequest`, and `enrich` only fills properties the object already has, so path/query
  params can't populate a field the empty body lacks — TypeScript has no `Activator.CreateInstance<T>()`
  to default-construct the erased DTO.
- Mesh contracts (`@benzene/mesh-contracts`): the shared data shapes and zero-I/O port interfaces of the
  Benzene mesh — the artifacts an aggregator publishes (`MeshManifest`, `MeshTopicCatalog` + `MeshTopicEntry`,
  `MeshUsage`, `MeshTopology` + `TopologyEdge`, `MeshAnnotationLog`, per-service `MeshServiceSnapshot`), the
  `mesh.json` registry with its `MeshRegistryJson` (de)serializer and `MeshDiscoveryRunner`/
  `MeshDiscoveryFilter`, the `MeshHashing` contract-drift hash, and the adapter seams
  (`IMeshDiscoveryProvider`/`IMeshUsageSource`/`IMeshReportPublisher`). Depends only on
  `@benzene/health-checks-core`, so it's the foundation the rest of the mesh (aggregator, wire, collector,
  discovery/usage adapters) builds on. Conventions applied throughout: `DateTimeOffset` → epoch-millisecond
  `number`, `System.Text.Json.Nodes.JsonObject` (inlined schemas) → arbitrary `Record<string, unknown>`,
  `CancellationToken` → optional `AbortSignal`, `HMACSHA256` (empty key) → `node:crypto`, and the static
  const-string classes → frozen objects. Two Mesh.Contracts-scoped test files ported (discovery runner +
  registry JSON round-trip + filter matching, and the hashing test — its cross-check against the unported
  `Benzene.CodeGen.Core` replaced by pinned known-answer HMAC digests).
- Mesh dispatch (`@benzene/mesh-dispatch`): the opt-in, environment-gated `mesh:dispatch` handler that
  invokes ONE registered service's real handler with a caller-supplied payload (the direct-to-consumer test
  path) — `MeshDispatchMessageHandler` + `MeshDispatchGate` (refused in Production unless
  `MeshDispatchOptions.allowInProduction`), the `IMeshServiceDispatcher` transport seam with a shipped
  `HttpMeshServiceDispatcher` (POSTs the `{ topic, headers, body }` envelope to `<origin>/benzene-message`
  or an explicit `invokeUrl`), and `useMeshDispatch` wiring. Adaptations: `HttpClient` → injectable `fetch`
  (`@benzene/health-checks-http`'s pattern); `CancellationToken` → optional `AbortSignal`; the environment
  reader checks `NODE_ENV` first (then the .NET `ASPNETCORE_ENVIRONMENT`/`DOTNET_ENVIRONMENT` for migrating
  teams), unset = Production (the safe default). Also ported the concrete `RawStringMessage` class into
  `@benzene/core-messages` (the handler's response type). The gate + handler test classes ported (9 tests);
  the AWS-Lambda-dispatcher test needs the unported `Benzene.Mesh.Aws.Lambda`, so HTTP-dispatcher
  port-verification tests stand in.
- Mesh self-reporting (`@benzene/mesh-reporting`): push-based reporting for services an aggregator can't
  poll — `HttpMeshReportPublisher` (POSTs a `MeshServiceReport` to an aggregator's ingestion endpoint) and
  `MeshSelfReportMiddleware`, which opportunistically publishes the service's own spec/health *after* real
  traffic completes, throttled by `MeshSelfReportOptions.minimumIntervalMs` (tracked in a singleton
  `MeshSelfReportState`) and fully best-effort (fire-and-forget, never delays the wrapped response, swallows
  publish/provider failures). Wired via `addMeshHttpReporting`/`addMeshSelfReport`/`useMeshSelfReport`.
  Adaptations: `HttpClient` → injectable `fetch` (`@benzene/health-checks-http`'s pattern); `DateTimeOffset`/
  `TimeSpan` → epoch-millisecond / millisecond `number`; the C# `Interlocked`-guarded `long` last-published
  tick → a plain `number | undefined` (Node's single-threaded event loop has no torn read/write to guard).
  Both test classes ported (7 tests: publisher POST + non-2xx-throws, and the five middleware tests —
  calls-next, first-call-publishes, throttle-skips-second-call, publisher-throws-swallowed, and
  doesn't-block-on-a-slow-publisher — with the C# `TaskCompletionSource` signal → a deferred promise).
- Mesh aggregator (`@benzene/mesh-aggregator`): the polling side of the mesh. `MeshAggregator.runOnceAsync`
  fetches every registered service's spec + health (via an `IMeshServiceSource` — `HttpMeshServiceSource`
  ships), computes each service's `MeshServiceSnapshot` + contract-drift (shared `MeshSnapshotBuilder`), and
  publishes a full artifact set to an `IMeshArtifactStore` (`FileSystemMeshArtifactStore` ships):
  `manifest.json`, per-service snapshots, the cross-service topic catalog (`topics.json` — version
  reconciliation, deprecation/gap status, schema-mismatch detection, and a run-over-run diff read back from
  the previous catalog), the structural `topology.json` (with usage-derived req/min + error-rate attribution
  where a merged `IMeshUsageSource` feed can pin traffic to an edge unambiguously), the composite
  `asyncapi.json` (`AsyncApiCompositor` namespaces every service's channels/operations/schemas and rewrites
  `$ref`s), and an optional `usage.json`. Also the push path (`ArtifactStoreMeshReportPublisher` +
  `MeshReportMessageHandler`), the discussion write path (`MeshAnnotationPublisher` +
  `MeshAnnotationsMessageHandler`), and `addMeshAggregator` wiring. Adaptations: `System.Text.Json` (nodes +
  document) → native `JSON.parse`/`JSON.stringify` throughout (schema `$ref`-inlining, the key-order-normalized
  canonical compare, and the AsyncAPI `$ref`-rewrite all work on parsed JSON); `HttpClient` → injectable
  `fetch` (`GetStringAsync`'s throw-on-non-2xx → a ported `HttpRequestException`, whose `name` is the only
  thing the aggregator records so a failed fetch can't leak a body); `DateTimeOffset`/`TimeSpan` → epoch-ms /
  ms `number`; `Task.WhenAll` → `Promise.all`; `SemaphoreSlim` (annotation-log write) → a promise-chain
  mutex; `File`/`Directory` → `node:fs/promises` (path-traversal guard preserved for untrusted push-report
  service names); `Guid.NewGuid()` → `node:crypto` `randomUUID`. The `[HttpEndpoint]`/`[Message]` handler
  attributes become `IHttpEndpointDefinition`/`IMessageHandlerDefinition` registrations in
  `addMeshAggregator` (the port's Extensions-registration convention, since JS has no assembly scan or
  constructor-parameter reflection). All six aggregator test classes ported (78 tests: catalog/topology/
  drift/usage-attribution, AsyncAPI composition, artifact-store round-trip + traversal rejection,
  snapshot-report drift, annotations, and the two message handlers) — the usage-attribution topology tests
  feed the framework wire statuses (`BenzeneResultStatus.notFound` = `not-found`, matching .NET).
- Mesh Tempo tracing (`@benzene/mesh-tracing-tempo`): the observed-traffic topology source (the complement
  to the aggregator's structural one). `TempoServiceGraphTopologyBuilder` queries Grafana Tempo's
  metrics-generator service-graph metrics via a Prometheus-compatible instant-query endpoint
  (`PrometheusQueryClient`) — request rate, failure rate, and p50/p95/p99 latency PromQL queries — and joins
  them into a `MeshTopology` of `TopologyEdgeSource.tempo` edges, published as `topology.json` by
  `TempoTopologyMessageHandler` (`POST /mesh/topology`, topic `mesh:topology`) into the same
  `IMeshArtifactStore` `addMeshAggregator` registered. Adaptations: `HttpClient` → injectable `fetch` (body
  read regardless of status, like `GetAsync`, so a Prometheus `"status":"error"`/non-2xx/malformed body
  swallows to an empty result while a connection-level failure still throws); `System.Text.Json` →
  `JSON.parse`; `TimeSpan` → ms `number` (the PromQL duration formatter's hour/minute/second cascade
  preserved); `DateTimeOffset` clock → epoch-ms `() => number`; the `(client, server)` tuple dictionary key
  → a collision-free JSON-encoded `Map` key; `[HttpEndpoint]`/`[Message]` → `addTempoTopology` registrations.
  Both C# test classes ported (6 tests: full/partial/empty/multi-edge builder cases + the publish handler).
- Mesh Azure adapters — the three Azure cloud integrations, each adapting its .NET Azure SDK to the
  official `@azure/*` JS-ecosystem package (the "third-party integrations are adapted, not reimplemented"
  convention), all authenticating with `@azure/identity`'s `DefaultAzureCredential`:
  - Azure Blob artifact store (`@benzene/mesh-azure-blob`): `BlobMeshArtifactStore` — an `IMeshArtifactStore`
    over an Azure Blob container, so an Azure-hosted mesh persists its aggregator artifacts + discovered
    registry centrally; wired via `addMeshAggregatorWithBlob`. `Azure.Storage.Blobs` → `@azure/storage-blob`
    (`MemoryStream` upload → `uploadData(Buffer)`, `DownloadContentAsync` → `downloadToBuffer()`,
    `RequestFailedException`/404 → a `RestError` with `statusCode 404`). No C# unit test (SDK-only).
  - Azure discovery (`@benzene/mesh-discovery-azure`): `AzureAppServiceDiscoveryProvider` discovers Benzene
    services from `Microsoft.Web/sites` resources — pure tag/region filtering + SSRF-safe host/path
    sanitisation over the `IAzureResourceLister` seam, whose real implementation (`AzureArmResourceLister`)
    adapts `Azure.ResourceManager` → `@azure/arm-resources`; wired via `addMeshAzureDiscovery`. Divergence:
    JS's `ResourceManagementClient` is subscription-scoped at construction (no `GetDefaultSubscriptionAsync`),
    so a subscription id is required (passed or from `AZURE_SUBSCRIPTION_ID`), and the resource group is
    parsed from the ARM id. Provider test class ported (6 tests).
  - Application Insights usage (`@benzene/mesh-usage-application-insights`): `ApplicationInsightsUsageSource`
    reads the `benzene.messages.processed` counter back as an `IMeshUsageSource` — pure mapping over the
    `IApplicationInsightsUsageQuery` seam, whose default (`LogsQueryUsageQuery`) issues KQL over the Log
    Analytics `customMetrics` table, adapting `Azure.Monitor.Query` → `@azure/monitor-query`
    (`QueryTimeRange` → a `{ startTime, endTime }` interval, non-`Success` result throws); wired via
    `addApplicationInsightsUsage`. The Azure sibling of the CloudWatch adapter. Source test class ported
    (4 tests). `TimeSpan` → ms `number` and `DateTimeOffset` → epoch ms throughout these three.
- Mesh AWS + Kubernetes adapters — the AWS and Kubernetes cloud integrations, each adapting its .NET SDK to
  the official ecosystem JS package (`@aws-sdk/client-*` v3, `@kubernetes/client-node`) under the same
  "adapted, not reimplemented" convention; the AWS SDK's v3 command pattern (`client.send(new XCommand(...))`)
  replaces the .NET `IAmazonX` interface methods, and — because the C# tests mocked those SDK interfaces
  directly — the SDK-coupled classes take the client directly (the test passes a stubbed `send`) rather than
  adding a seam:
  - S3 artifact store (`@benzene/mesh-aws-s3`): `S3MeshArtifactStore` — an `IMeshArtifactStore` over an S3
    bucket, so a Lambda-hosted mesh persists its artifacts centrally; wired via `addMeshAggregatorWithS3`.
    `AWSSDK.S3` → `@aws-sdk/client-s3` (`GetObject` response stream → `Body.transformToString`,
    `AmazonS3Exception`/404 → a `NoSuchKey`/`$metadata.httpStatusCode === 404` check). No C# unit test (SDK-only).
  - AWS Lambda discovery (`@benzene/mesh-discovery-aws`): `AwsLambdaDiscoveryProvider` discovers services from
    tagged Lambda functions (paginated `ListFunctions` + bounded-concurrency `ListTags`) as `AwsLambdaInvoke`
    entries; `AWSSDK.Lambda` → `@aws-sdk/client-lambda`, the `SemaphoreSlim`+ordered-`WhenAll` tag reads → an
    order-preserving bounded-concurrency map. Provider test class ported (4 tests).
  - CloudWatch usage (`@benzene/mesh-usage-cloudwatch`): `CloudWatchUsageSource` reads the
    `benzene.messages.processed` counter back (`ListMetrics` to enumerate live dimension combinations, one
    `GetMetricData` `Sum` query each, 500-query chunked) as an `IMeshUsageSource`; `AWSSDK.CloudWatch` →
    `@aws-sdk/client-cloudwatch`. The AWS sibling of the Application Insights adapter. Source test class
    ported (3 tests).
  - Kubernetes discovery (`@benzene/mesh-discovery-kubernetes`): `KubernetesServiceDiscoveryProvider`
    discovers services from Kubernetes Services — pure label-selector construction + in-cluster-DNS URL
    building (`{name}.{namespace}.svc.cluster.local`) + SSRF-safe scheme/path sanitisation over the
    `IKubernetesServiceLister` seam, whose real implementation (`KubernetesApiServiceLister`) adapts the
    Kubernetes SDK to `@kubernetes/client-node`'s `CoreV1Api` (v1's single-param list methods); wired via
    `addMeshKubernetesDiscovery` (`KubeConfig.loadFromCluster`). Provider test class ported (8 tests).
  Deferred: `Mesh.Fleet.Aws.XRay` needs `Mesh.Collector`, not yet ported. (`Mesh.Wire`'s ServiceDescriptor
  path is now ported as `@benzene/mesh-wire`, with a pluggable schema provider in place of CLR reflection;
  the collector and the trace/heartbeat feeds remain.)
- AWS Lambda outbound client + its mesh integration:
  - Low-level Lambda client (`@benzene/clients-aws-lambda`): `AwsLambdaClient` (an `IAwsLambdaClient`) invokes
    a function synchronously (`RequestResponse`) or fire-and-forget (`Event`) via `@aws-sdk/client-lambda`,
    serializing the request / deserializing the response payload as JSON and surfacing a `FunctionError` as
    an `AwsLambdaFunctionErrorException`; `LocalAwsLambdaClientFactory` builds a profile-authenticated client
    (`CredentialProfileStoreChain` → `@aws-sdk/credential-providers`' `fromIni`, async because JS credential
    resolution is lazy). `IAmazonLambda.InvokeAsync` → the v3 command pattern; the request/response `Stream`
    payloads → `Uint8Array`. Two C# test classes ported (4 tests). **Deferred** (documented in the package's
    `index.ts`): the high-level `AwsLambdaBenzeneMessageClient` — its `typeof(TResponse) == typeof(Void)`
    fire-and-forget branch has no runtime equivalent under TS generic erasure — plus the outbound
    middleware-pipeline converter and the `AwsLambdaHealthCheck` (which needs the not-yet-ported
    `HealthCheckMode`/`HealthCheckError`/persistent-failure health-check infra).
  - AWS Lambda mesh integration (`@benzene/mesh-aws-lambda`, now unblocked): `LambdaMeshServiceSource`
    interrogates a Lambda-hosted service's spec/health via a synchronous invoke (for services with no HTTP
    surface), and `AwsLambdaMeshServiceDispatcher` dispatches `mesh:dispatch` messages to one — both over
    `@benzene/clients-aws-lambda`'s `IAwsLambdaClient` (taken lazily so a pure-HTTP mesh never builds a Lambda
    client), wired via `addMeshLambdaSource`/`addMeshLambdaDispatcher`. Adaptations: C#'s `Activity.Current`
    W3C trace propagation → the active OpenTelemetry span context (`@opentelemetry/api`), emitted as a
    `traceparent` header; `Task.WaitAsync(cancellationToken)` → an `AbortSignal` raced against the invoke (the
    underlying client has no cancellation parameter). Service-source test class ported (7 tests, including the
    W3C-propagation test via the shared OpenTelemetry harness).
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
  `@benzene/diagnostics`' inbound `useW3CTraceContext`). Still deferred: `validateOutboundRouting` (in .NET,
  assembly reflection over `Benzene.CodeGen.Client` generated-client routing contracts; the generator itself
  is now ported as `@benzene/codegen-client`, but the reflective startup-validation surface is not).

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

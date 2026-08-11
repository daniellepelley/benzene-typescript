# Common Middleware

This page catalogs Benzene's general-purpose, transport-agnostic pipeline middleware — the building
blocks you'll reach for on almost any pipeline, regardless of whether it's running on AWS Lambda,
Azure Functions, Express, or a self-hosted worker. Transport-specific middleware (`useApiGateway`,
`useSqs`, `useSns`, `useKafka`, `useEventHub`, ...) is covered in the platform getting-started
guides instead.

Because TypeScript has no extension methods, the fluent `.Use*()` helpers C# defines on the pipeline
builder become **free functions that take the builder as their first argument and return it** —
`useTimer(app, 'name')`, `useRetry(app)`, `useMessageHandlers(app, Handler)`. The few that *do* live
in the builder's own package stay builder members (`app.useLogResult(...)`,
`app.useExceptionHandler(...)`). See [Middleware](middleware.md) for the pipeline mechanism itself and
[Porting conventions](../README.md#porting-conventions) for why the split falls where it does.

Every entry below has been verified against the current source in `src/`. Where a deeper reference
page already exists (validation, correlation ids), this page gives the essentials and links out for
the full story.

## Table of contents

- [useTimer](#usetimer)
- [useBenzeneEnrichment](#usebenzeneenrichment)
- [useBenzeneMetrics](#usebenzenemetrics)
- [useW3CTraceContext](#usew3ctracecontext)
- [useBenzeneInvocation](#usebenzeneinvocation)
- [useHealthCheck](#usehealthcheck)
- [useMessageHandlers](#usemessagehandlers)
- [usePresetTopic](#usepresettopic)
- [Validation](#validation)
- [useLogResult / useLogContext](#uselogresult--uselogcontext)
- [useExceptionHandler](#useexceptionhandler)
- [useRetry](#useretry)
- [useOAuth2Bearer](#useoauth2bearer)
- [useBasicAuth](#usebasicauth)
- [requireScope](#requirescope)
- [useXml](#usexml)
- [useMessagePack](#usemessagepack)

---

## useTimer

**Package:** `@benzene/diagnostics`

Opens a named span around the rest of the pipeline. Every middleware already gets its own span
automatically via `addDiagnostics()` (see [Middleware — automatic activity
wrapping](middleware.md#automatic-activity-wrapping-imiddlewarewrapper)) — `useTimer` is for naming a
specific stage explicitly so it stands out in an exported trace. Internally it resolves the registered
`IProcessTimerFactory` (the `addDiagnostics()`-registered default, `ActivityProcessTimerFactory`, opens a
real OpenTelemetry span); if none is registered it's a no-op wrapper around `next()`.

C# overloads `UseTimer` twice; the two forms are distinguishable at runtime here (a `string` timer
name vs a callback), so they collapse into one function that dispatches on `typeof`:

```ts
export function useTimer<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  timerNameOrOnTimer: string | OnTimer<TContext>,
): IMiddlewarePipelineBuilder<TContext>;
```

```ts
import { useTimer } from '@benzene/diagnostics';

// name a stage explicitly (resolves IProcessTimerFactory):
useTimer(app, 'benzene-message-application');

// or handle the elapsed time yourself:
useTimer(app, (context, elapsedMs) => myMetrics.record(elapsedMs));
```

---

## useBenzeneEnrichment

**Package:** `@benzene/diagnostics`

One portable, explicit-opt-in call that attaches `invocationId`, `traceId`, `spanId`, `topic`,
`transport`, and `handler` to the logging scope (via `ILogger.beginScope`) for the duration of the
request, and tags the current span with `benzene.invocationId` — all in a single function that works
the same way on AWS Lambda, Azure Functions, and Express. Each key is resolved independently and
simply omitted if its backing service isn't registered for that pipeline (for example, `invocationId`
requires [`useBenzeneInvocation()`](#usebenzeneinvocation) to have run on this pipeline or an outer
one).

```ts
export function useBenzeneEnrichment<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
): IMiddlewarePipelineBuilder<TContext>;
```

```ts
import { useBenzeneEnrichment } from '@benzene/diagnostics';

useBenzeneEnrichment(app);
```

**When to use it:** on every platform. It's safe to add unconditionally — an unresolved key is
dropped rather than erroring.

---

## useBenzeneMetrics

**Package:** `@benzene/diagnostics`

Records `benzene.messages.processed` (a counter) and `benzene.message.duration` (a histogram, in
milliseconds) for the wrapped pipeline stage, tagged by `topic`, `transport`, and `result`
(`success`/`failure`, read from `IHasMessageResult` when the context implements it). Unlike the
automatic per-middleware spans from `addDiagnostics()`, this is once-per-message granularity and must
be added explicitly around the stage you want measured.

```ts
export function useBenzeneMetrics<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
): IMiddlewarePipelineBuilder<TContext>;
```

```ts
import { useBenzeneMetrics } from '@benzene/diagnostics';

useBenzeneMetrics(app);
```

The instruments are OpenTelemetry JS instruments (`@opentelemetry/api`). Register an OpenTelemetry SDK
`MeterProvider` in your process to export them to a real backend; with no SDK registered they stay
no-op, so it's cheap to leave in.

---

## useW3CTraceContext

**Package:** `@benzene/diagnostics`

Reads the `traceparent` header (matched case-insensitively) and starts the pipeline's root span with
the parsed remote context as its parent, so distributed traces continue across services instead of
each hop starting a new, disconnected trace. Falls back to a normal, parentless root span when the
header is missing or fails to parse — it's always safe to add.

```ts
export function useW3CTraceContext<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
): IMiddlewarePipelineBuilder<TContext>;
```

```ts
import { useW3CTraceContext } from '@benzene/diagnostics';

useW3CTraceContext(app);
```

**Add this as the FIRST middleware in the pipeline** — everything added after it inherits this span as
the ambient parent, so every automatically-wrapped middleware span from `addDiagnostics()` correctly
nests under the remote trace.

> **Port note.** C#'s `ActivityContext.TryParse` maps to building an OpenTelemetry `SpanContext` from
> the ported `parseTraceparent`; `tracestate` isn't threaded through (`@opentelemetry/api` exposes no
> `TraceState` constructor), but the load-bearing trace continuity — trace id + parent span id — is.
> The `traceparent` parser itself is exported for reuse; see [Correlation
> Ids](correlation-ids.md) for the smaller `ICorrelationId` marker.

---

## useBenzeneInvocation

**Package:** `@benzene/core-middleware` (core overload); each hosting package ships a zero-argument
overload.

Builds and exposes an `IBenzeneInvocation` for the duration of the request so it can be injected
wherever needed, and so [`useBenzeneEnrichment()`](#usebenzeneenrichment) can populate `invocationId`.
You don't normally call the core overload directly — hosting platforms expose their own overload that
supplies the factory (e.g. `@benzene/aws-lambda-core`'s `useBenzeneInvocation`, which reads the Lambda
`awsRequestId`).

```ts
// core (@benzene/core-middleware) — supply the factory yourself:
export function useBenzeneInvocation<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  factory: (serviceResolver: IServiceResolver, context: TContext) => IBenzeneInvocation,
): IMiddlewarePipelineBuilder<TContext>;
```

```ts
// on AWS Lambda, just call the platform's zero-arg overload:
import { useBenzeneInvocation } from '@benzene/aws-lambda-core';

useBenzeneInvocation(app);
```

Requesting `IBenzeneInvocation` from the container before this middleware has run for the current
invocation is only meaningful once the middleware has populated it — it's scoped to the request this
middleware wraps.

---

## useHealthCheck

**Package:** `@benzene/health-checks`

Lets health checks be triggered by sending a message on a given topic. By default the built-in health
check topic always matches too (alongside whatever topic you register), so a single service's own
health check is always reachable at the default topic while you're free to also expose it under
something like `"<service-name>:healthcheck"` for cross-service calls.

C#'s three `UseHealthCheck` overloads (a list of `IHealthCheck` instances, a builder-configuring
callback, or an already-built `IHealthCheckBuilder`) collapse into one `config` parameter dispatched
at runtime:

```ts
export type HealthCheckConfig =
  | IHealthCheck[]
  | ((builder: IHealthCheckBuilder) => void)
  | IHealthCheckBuilder;

export function useHealthCheck<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  topic: string,
  config: HealthCheckConfig,
): IMiddlewarePipelineBuilder<TContext>;
```

```ts
import { useHealthCheck } from '@benzene/health-checks';

// configure a builder (checks resolved from the container, or supplied as a factory):
useHealthCheck(app, 'healthcheck', (checks) => checks
  .addHealthCheck(MyDatabaseHealthCheck)
  .addHealthCheckFn((resolver) => resolver.getService(MyQueueHealthCheck)));

// or pass already-constructed instances directly:
useHealthCheck(app, 'healthcheck', [new MyDatabaseHealthCheck(), new MyQueueHealthCheck()]);
```

A health check implements `IHealthCheck` (`@benzene/health-checks-core`):

```ts
export interface IHealthCheck {
  readonly type: string;                          // its key in the aggregated response
  executeAsync(): Promise<IHealthCheckResult>;    // report failures via the result, don't throw
}
```

The port also ships Kubernetes-style **`useLivenessCheck(app, config)`** and
**`useReadinessCheck(app, config)`**, which match the dedicated liveness/readiness topics instead of
the shared health topic — put dependency checks (DB, queue) behind readiness so a failure removes the
pod from service without restarting it, and keep liveness to "is this process itself responsive".

---

## useMessageHandlers

**Package:** `@benzene/core-message-handlers`

The middleware that routes the raw message to a message handler, by pulling out the topic and
deserializing the payload. Pass the handler classes you want served (discovery limited to those), or
pass none to serve everything already registered in the global `MessageHandlersRegistry`:

```ts
export function useMessageHandlers<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  ...handlerTypes: Constructor<unknown>[]
): IMiddlewarePipelineBuilder<TContext>;
```

```ts
import { useMessageHandlers } from '@benzene/core-message-handlers';

useMessageHandlers(app, CreateOrderHandler, GetOrderHandler);   // specific handlers
useMessageHandlers(app);                                         // everything registered
```

To add middleware to the message router itself — most commonly validation, which runs **per handler
invocation** — use the router variant. C#'s router overloads are indistinguishable from the plain ones
at runtime, so per the porting convention they split by name into `useMessageHandlersWithRouter`:

```ts
import { useMessageHandlersWithRouter } from '@benzene/core-message-handlers';
import { useZodValidation } from '@benzene/zod';

useMessageHandlersWithRouter(app, (router) => useZodValidation(router), CreateOrderHandler);
```

See [Message Handlers](message-handlers.md) for how the router dispatches, and
[Validation](validation.md) for the router-nested validation middleware.

---

## usePresetTopic

**Package:** `@benzene/core-message-handlers`

Routes **every** message on this one pipeline to a fixed topic, regardless of what (if anything) the
transport message itself carries. For a queue or subscription whose producer isn't a Benzene client
and never sets the usual `topic` message attribute (a raw SQS send, a Service Bus topic fed by another
system, etc.) — call it before `useMessageHandlers()`, on that specific pipeline only. A queue whose
producer does send a proper topic just omits it and is unaffected.

```ts
export function usePresetTopic<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  topicId: string,
  version = '',
): IMiddlewarePipelineBuilder<TContext>;
```

```ts
import { usePresetTopic, useMessageHandlers } from '@benzene/core-message-handlers';
import { useSqs } from '@benzene/aws-lambda-sqs';

// A queue whose producer never sets a topic attribute at all:
useSqs(app, (sqs) => {
  usePresetTopic(sqs, 'orders.created');
  useMessageHandlers(sqs, ProcessOrderHandler);
});
```

Once set, the preset topic always wins for that pipeline's messages — even if a message happens to
carry a stray `topic` attribute — so there's no separate "fallback vs. override" mode to configure.

> **Implementation note for anyone extending Benzene with a new transport.** The preset topic is
> carried in a small scoped (per-message) DI service (`PresetTopicHolder`), not a property on the
> transport context — a context type stays a pure description of the transport message, per this
> repo's context-purity convention. `usePresetTopic` has no constraint on `TContext`, so any transport
> gets this for free by wrapping its own topic getter with `PresetTopicMessageTopicGetter<TContext>`
> and registering `PresetTopicHolder` scoped — no context changes required. The AWS SQS and Azure
> Service Bus adapters are the reference implementations.

---

## Validation

**Packages:** `@benzene/zod`, `@benzene/joi`, `@benzene/yup` (adapters), over
`@benzene/abstractions-validation`

Validation nests inside the [`useMessageHandlersWithRouter`](#usemessagehandlers) router callback. It
looks up the schema registered for the request type; if one is found and validation fails, it
short-circuits with a `validation-error` result before the request ever reaches the message handler.
If no schema is registered for the type, the request passes straight through.

.NET's `Benzene.FluentValidation` / `Benzene.DataAnnotations` wrap .NET-only validators, so — per the
[third-party-integration convention](../README.md#porting-conventions) — they're re-created as
adapters over the popular JavaScript validators (Zod, Joi, Yup), each mirroring the same integration
shape (a `use<Lib>Validation` router helper plus a schema registry keyed by request class):

```ts
import { useMessageHandlersWithRouter } from '@benzene/core-message-handlers';
import { useZodValidation } from '@benzene/zod';

useMessageHandlersWithRouter(app, (router) => useZodValidation(router), CreateOrderHandler);
```

See [Validation](validation.md) for registering schemas, the status mapping, and the Joi/Yup variants.
(The .NET `useJsonSchema` middleware — schema generation via `JsonSchema.Net` — has no separate port;
schema-based request validation is covered by these adapters instead.)

---

## useLogResult / useLogContext

**Package:** `@benzene/core-middleware` (pipeline-builder **members**)

These two live in the builder's own package, so — unlike the free functions above — they're methods on
the pipeline builder. Both attach properties to the logging scope (via `ILogger.beginScope`) for the
duration of the request, configured through the same `ILogContextBuilder<TContext>`:

- **`useLogResult`** additionally measures processing time and emits a single structured
  `"BenzeneResult"` log line per execution, with request-scope, response-scope, and `processTime`
  properties all attached.
- **`useLogContext`** just enriches the scope for the request — it doesn't log anything itself.

```ts
app.useLogResult((x) => CorrelationExtensions.withCorrelationId(x));
```

The `ILogContextBuilder<TContext>` handed to your callback exposes `onRequest` / `onResponse` tap
points that return a dictionary merged into the scope, so you can attach any context-derived fields:

```ts
app.useLogContext((x) =>
  x.onRequest((context) => ({ topic: context.topic })),
);
```

### Log-context builder extensions

`withCorrelationId` (`@benzene/diagnostics`, exported under the `CorrelationExtensions` namespace)
adds the current `ICorrelationId` value under the `correlationId` key, registering the `CorrelationId`
service for the pipeline if it isn't already:

```ts
import { CorrelationExtensions } from '@benzene/diagnostics';

app.useLogResult((x) => CorrelationExtensions.withCorrelationId(x));
```

For a portable, cross-platform enrichment that covers topic, transport, handler, and invocation id in
one call, prefer [`useBenzeneEnrichment()`](#usebenzeneenrichment). See [Correlation
Ids](correlation-ids.md) for the full correlation-id story.

---

## useExceptionHandler

**Package:** `@benzene/core-middleware` (pipeline-builder **member**)

Adds centralized exception handling around the rest of the pipeline: any error thrown by downstream
middleware or the handler is caught and passed to your callback, letting you log it, transform it into
an error result on the context, or otherwise handle it in a context-aware way. It logs the error (via
`ILoggerFactory`, falling back to a null logger) and then invokes your callback — it does not rethrow.

```ts
app.useExceptionHandler((context, error) => {
  // e.g. map it onto the context's result:
  context.result = BenzeneResult.unexpectedError();
});
```

See [Middleware — useExceptionHandler](middleware.md#useexceptionhandler) for the pipeline-level
mechanics.

---

## useRetry

**Package:** `@benzene/resilience`

Wraps the rest of the pipeline in a retry loop with exponential backoff. Retries on any error by
default, and does not retry a *successful* result unless you supply `shouldRetryContext`. This is a
small, hand-rolled retry loop — no external dependency. C#'s positional parameters become a single
trailing options object:

```ts
export interface RetryOptions<TContext> {
  numberOfRetries?: number;                          // default 3
  initialDelayMs?: number;                           // default 200
  backoffFactor?: number;                            // default 2.0
  shouldRetry?: (error: unknown) => boolean;         // default: retry on any error
  shouldRetryContext?: (context: TContext) => boolean; // default: never retry a completed result
  delay?: DelayFunc;                                 // default: a timer-backed delay
}

export function useRetry<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  options?: RetryOptions<TContext>,
): IMiddlewarePipelineBuilder<TContext>;
```

```ts
import { useRetry } from '@benzene/resilience';

useRetry(app, { numberOfRetries: 5, initialDelayMs: 100 });
```

---

## useOAuth2Bearer

**Package:** `@benzene/auth-oauth2` (over `jose`)

OAuth2 bearer token (JWT) validation for services that have no security-terminating gateway in front
of them. Reads `Authorization: Bearer <token>`, validates it against a JWKS endpoint (via OIDC
discovery or a bare JWKS URI), and either short-circuits with `unauthorized` or sets the authenticated
caller for later pipeline steps.

```ts
export function useOAuth2Bearer<TContext extends IHttpContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  options: OAuth2BearerOptions,
): IMiddlewarePipelineBuilder<TContext>;
```

```ts
import { useOAuth2Bearer, OAuth2BearerOptions } from '@benzene/auth-oauth2';

const options = new OAuth2BearerOptions();
options.authority = 'https://your-tenant.auth0.com/.well-known/openid-configuration';
options.validIssuers = ['https://your-tenant.auth0.com/'];
options.validAudiences = ['your-api-identifier'];
options.validAlgorithms = ['RS256'];

useOAuth2Bearer(app, options);
```

Applies to any `TContext extends IHttpContext`. Set exactly one of `authority` / `jwksUri`, and
`validIssuers`, `validAudiences`, and `validAlgorithms` are all required — an empty allowlist would
silently under-validate every token, so `useOAuth2Bearer` calls `options.validate()` and **throws at
wire-up time** rather than accepting tokens from any issuer/audience/algorithm. `validAlgorithms` in
particular has no permissive default: a validator that trusted whatever `alg` a token claimed would be
open to algorithm-confusion attacks (RFC 8725 §3.1). A failed validation always returns a generic
`unauthorized` detail — the real reason (bad signature, expired, wrong issuer/audience) is only logged
server-side. On success, the validated claims are available to [`requireScope`](#requirescope) and to
your own handlers via `AuthenticationHolder` (`@benzene/auth-core`). See the [Cookbooks](cookbooks/README.md)
for a full worked auth example.

---

## useBasicAuth

**Package:** `@benzene/auth-basic`

RFC 7617 HTTP Basic authentication — the simplest option when you just need a username/password gate
(a single service account, an internal admin surface) rather than full OAuth2. Validates the decoded
credentials against your own `IBasicAuthCredentialValidator`; ships no default implementation, so
there's no hardcoded-credential footgun to accidentally deploy.

```ts
export function useBasicAuth<TContext extends IHttpContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  validator: IBasicAuthCredentialValidator,
  realm = 'Benzene',
): IMiddlewarePipelineBuilder<TContext>;
```

```ts
import { useBasicAuth, IBasicAuthCredentialValidator } from '@benzene/auth-basic';
import { Claim, ClaimsIdentity, ClaimsPrincipal, ClaimTypes } from '@benzene/auth-core';

class ServiceAccountValidator implements IBasicAuthCredentialValidator {
  async validateAsync(username: string, password: string): Promise<ClaimsPrincipal | undefined> {
    const expected = process.env.SERVICE_ACCOUNT_PASSWORD;
    if (username !== 'service-account' || password !== expected) {
      return undefined;
    }
    const identity = new ClaimsIdentity([new Claim(ClaimTypes.name, username)], 'Basic');
    return new ClaimsPrincipal(identity);
  }
}

useBasicAuth(app, new ServiceAccountValidator());
```

Applies to any `TContext extends IHttpContext`. A missing/malformed header or a validator returning
`undefined` short-circuits with `unauthorized` and a `WWW-Authenticate: Basic realm="..."` challenge
header (per RFC 7617, so browsers/HTTP clients actually prompt for credentials). Credentials are split
on the *first* `:` only — a password containing `:` is preserved intact, not truncated.

---

## requireScope

**Package:** `@benzene/auth-oauth2`

Basic scope-based authorization: requires the caller authenticated by
[`useOAuth2Bearer`](#useoauth2bearer), earlier in the pipeline, to hold at least one of the given
scopes. Reads both the `scope` claim (RFC 8693, space-delimited) and the `scp` claim (Azure AD's
convention — a space-delimited string or a JSON array, depending on issuer; both are normalized).

```ts
export function requireScope<TContext extends IHttpContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  ...anyOfScopes: string[]
): IMiddlewarePipelineBuilder<TContext>;
```

```ts
import { useOAuth2Bearer, requireScope } from '@benzene/auth-oauth2';

useOAuth2Bearer(app, options);
requireScope(app, 'orders:write');   // any one of the given scopes is sufficient
```

Applies to any `TContext extends IHttpContext`, chained after `useOAuth2Bearer`. No authenticated
caller at all (no auth middleware ran, or it ran and failed) short-circuits with `unauthorized` — a
caller present but missing every requested scope short-circuits with `forbidden` instead. These are
deliberately distinct statuses (`unauthorized` = not authenticated, `forbidden` = authenticated but
not permitted); collapsing them would leave API consumers unable to tell the two apart from a 403
alone. Role- and policy-based authorization primitives live in `@benzene/auth-core`
(`AuthorizationExtensions`) — see the [Cookbooks](cookbooks/README.md).

---

## useXml

**Package:** `@benzene/xml` (over `fast-xml-parser`)

Registers an XML `IMediaFormat<TContext>` (`XmlMediaFormat<TContext>`) alongside the default JSON one,
so the pipeline can serialize/deserialize XML payloads in addition to JSON — which format applies to a
given request/response is resolved per-message by the media-format negotiator (`content-type` for
reads, `accept` for writes).

```ts
export function useXml<TContext>(
  source: IMiddlewarePipelineBuilder<TContext>,
): IMiddlewarePipelineBuilder<TContext>;
```

```ts
import { useXml } from '@benzene/xml';

useXml(app);
```

---

## useMessagePack

**Package:** `@benzene/messagepack` (over `@msgpack/msgpack`)

Registers a MessagePack `IMediaFormat<TContext>` (`MessagePackMediaFormat<TContext>`) alongside the
default JSON one (and XML, if `useXml()` is also called) — same per-message negotiation as `useXml()`,
via `content-type`/`accept: application/msgpack`. MessagePack is a genuinely binary format, but every
Benzene transport's body is a `string`; the serializer Base64-armors the msgpack bytes so it works
unchanged through the existing string-based pipeline — a client sending/receiving MessagePack must
Base64-decode/encode the body accordingly.

```ts
export function useMessagePack<TContext>(
  source: IMiddlewarePipelineBuilder<TContext>,
): IMiddlewarePipelineBuilder<TContext>;
```

```ts
import { useMessagePack } from '@benzene/messagepack';

useMessagePack(app);
```

---

## Start-up checks

**Package:** `@benzene/core-message-handlers`

Boot-time wiring checks run once during host initialization — before any message is handled — so a
wiring bug fails INIT rather than surfacing as a failure on the message path later. Every host runs them
from its `StartUpRunner`; because the AWS/Azure test hosts boot through the same runner, the same bug is
also a red unit test. Checks are registered as a collection (the `IStartUpCheck` token) and run by
`runStartUpChecks(factory)`.

`addBenzene()` registers two:

- **`duplicate-topic`** — two different handlers claiming the same topic and version; **throws**.
- **`empty-handler-registry`** — handler dispatch was wired but no handlers were discovered (usually the
  wrong module passed to `addMessageHandlers(...)`); **logs a warning** (a probe- or collector-only
  deployable legitimately has zero handlers).

Other packages contribute their own: `@benzene/clients-in-process` adds **`in-process-routes`**, which
fails start-up when a `useInProcess(name)` route names a pipeline nothing registered.

One switch governs all of them:

```ts
import { addBenzeneStartUpChecks, BenzeneStartUpCheckMode } from '@benzene/core-message-handlers';

// Log check failures instead of failing start-up…
addBenzeneStartUpChecks(container, BenzeneStartUpCheckMode.Advisory);
// …or turn every check off.
addBenzeneStartUpChecks(container, BenzeneStartUpCheckMode.Disabled);
```

**Divergence:** the .NET `pipeline-resolution` and `terminal-middleware` checks need a pipeline-descriptor
feed the port doesn't have yet, and `outbound-routing` needs `validateOutboundRouting` (itself not ported),
so those three are deferred; `.WarmUp()` is likewise not ported.

---

## Not yet ported

A few transport-agnostic .NET middleware have no TypeScript port today:

- **`UseCors`** (`Benzene.Http`) — CORS handling for HTTP transports is not yet ported.
- **`UseJsonSchema`** (`Benzene.JsonSchema`) — superseded by the [validation](#validation) adapters.

The spec endpoint **is** ported: **`useSpec`** (`@benzene/schema-openapi`) serves the service's spec
document (topics + payload JSON Schemas) on the reserved `spec` topic in three formats — the default
`benzene` event-service document, real `openapi` (OpenAPI 3.0), and real `asyncapi` (AsyncAPI 3.0),
selected by the spec request's `type` — and **`useSpecUi`** (`@benzene/spec-ui`) renders it in-browser,
Swagger-UI style. Every format is emitted as JSON (the C# YAML output is not ported; see that package's
`index.ts` divergence note). The mesh-descriptor surface —
`useMeshDescriptor(app, descriptor)` (`@benzene/mesh-wire`), consumed by `@benzene/codegen-client` and
the mesh aggregator — is a related but distinct language-neutral descriptor; see the README's
[Multi-language interoperability](../README.md#multi-language-interoperability) section.

The vendor-specific tracing packages `Benzene.Datadog` and `Benzene.Zipkin` have no port —
`@benzene/diagnostics` is built on `@opentelemetry/api`, so `useTimer(name)`, `useBenzeneMetrics`, and
the automatic per-middleware spans export to any OpenTelemetry-compatible backend once you register an
OpenTelemetry SDK in your process. (AWS X-Ray *is* available directly, via `@benzene/aws-lambda-xray`,
as an alternative to the OpenTelemetry path.)

## See also

- [Middleware](middleware.md) — the pipeline mechanism these are built on, and the builder members
  (`useLogResult`, `useExceptionHandler`, `split`, `convert`).
- [Message Handlers](message-handlers.md) — how `useMessageHandlers` dispatches to individual handlers.
- [Validation](validation.md) — request validation via Zod / Joi / Yup.
- [Correlation Ids](correlation-ids.md) — the `ICorrelationId` marker and `withCorrelationId`.
- [Message Results](message-result.md) — the result type this middleware sets on the context.

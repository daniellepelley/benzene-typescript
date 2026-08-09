# Middleware

Middleware in Benzene is the pipeline mechanism that every request/event flows through on its way to (and
back from) a handler. Each middleware component sits in a chain of responsibility: it can act before calling
the next middleware, act after it returns, or stop the chain entirely by not calling `next()`. This is the
core building block hexagonal "ports" are wired up with — Express, AWS Lambda (API Gateway, SQS, SNS,
EventBridge, Kafka), and Azure Functions all configure the same kind of pipeline, just with a different
`TContext`.

## Core abstractions

These live in `@benzene/abstractions-middleware`.

### `IMiddleware<TContext>`

```ts
export interface IMiddleware<TContext> {
  readonly name: string;
  handleAsync(context: TContext, next: NextFunc): Promise<void>;
}
```

`name` identifies the middleware for logging/diagnostics (see
[Automatic activity wrapping](#automatic-activity-wrapping-imiddlewarewrapper) below). `NextFunc` is
`() => Promise<void>`. Implementations decide when to call `next`:

```ts
export class MyMiddleware implements IMiddleware<MyContext> {
  readonly name = 'MyMiddleware';

  async handleAsync(context: MyContext, next: NextFunc): Promise<void> {
    // runs on the way in
    await next(); // continue the chain — omit this to short-circuit
    // runs on the way back out
  }
}
```

### `IMiddlewarePipeline<TContext>`

The built, executable pipeline:

```ts
export interface IMiddlewarePipeline<TContext> {
  handleAsync(context: TContext, serviceResolver: IServiceResolver): Promise<void>;
}
```

Pipelines are immutable and reusable once built — the same `IMiddlewarePipeline<T>` instance can process
many requests concurrently.

### `IMiddlewarePipelineBuilder<TContext>`

The fluent builder used to compose a pipeline. Because TypeScript has no extension methods, the fluent
helpers C# defines as `Use`/`OnRequest`/`OnResponse`/`Split`/`Convert`/… extension methods are **declared as
interface members** here and implemented once in `MiddlewarePipelineBuilderBase`. Where C# overloads on
delegate type (indistinguishable at JS runtime), the methods **split by name**: `use` vs `useFn`.

```ts
builder
  .use(func | middlewareInstance)     // factory function OR an existing IMiddleware instance
  .useFn([name,] fn)                   // inline function middleware, optionally named
  .useService(identifier)             // resolve a middleware from the container
  .onRequest([name,] action)          // run before the rest of the pipeline
  .onResponse([name,] action)         // run after the rest of the pipeline
  .useExceptionHandler(onException)   // centralized try/catch
  .split(check, branch)               // conditional branch
  .convert(converter, innerPipeline)  // convert to another context type
  .create<TNewContext>()              // new builder for a different context, shared registration
  .build();                           // finalize
```

`create<TNewContext>()` makes a **new** builder for a different context type that shares the same underlying
dependency registration — this is what backs `split` and `convert`. `build()` finalizes the pipeline;
nothing can be added afterwards. Middleware runs in registration order (first registered runs first on the
way in, last on the way out).

Creating a builder registers `addBenzeneMiddleware()` for you (the middleware factory and the container's
service resolver), so `IMiddlewareFactory` is always available.

## Building a pipeline

A typical AWS Lambda startup composes several pipelines, one per transport. Because the fluent helpers that
live *downstream* of the builder (like `useMessageHandlers`) are free functions taking the builder first,
you nest them rather than chaining a `.useMessageHandlers()` method:

```ts
import { addBenzene, useMessageHandlers } from '@benzene/core-message-handlers';
import { InlineAwsLambdaStartUp } from '@benzene/aws-lambda-core';
import { useSqs } from '@benzene/aws-lambda-sqs';
import { useApiGateway } from '@benzene/aws-lambda-api-gateway';

const entryPoint = new InlineAwsLambdaStartUp()
  .configureServices((services) => addBenzene(services))
  .configure((app) => {
    useApiGateway(app, (api) => useMessageHandlers(api, CreateOrderHandler));
    useSqs(app, (sqs) => useMessageHandlers(sqs, ProcessOrderHandler));
  })
  .build();
```

## Inline middleware: `useFn` and `use`

You rarely need to write a dedicated `IMiddleware<TContext>` class:

```ts
// An existing middleware instance
app.use(new MyMiddleware());

// Inline, unnamed function middleware
app.useFn(async (context, next) => { await next(); });

// Inline, named function middleware (name shows up in diagnostics)
app.useFn('my-middleware', async (context, next) => { await next(); });

// Inline middleware with access to the resolver (per-request) — resolver is the trailing argument
app.useFn('my-middleware', async (context, next, resolver) => {
  const logger = resolver.tryGetService(ILoggerFactory)?.createLogger('my-middleware');
  logger?.logInformation('handling');
  await next();
});

// Resolve a middleware type from the container
app.useService(MyMiddleware);
```

The handler function signature is `(context, next, serviceResolver)` — context-first, with the resolver as
an optional trailing argument (this replaces C#'s resolver-first overloads). Middleware added without a name
gets `"Unnamed"` as its `name`.

## `onRequest` / `onResponse`

Tap points for code that only needs to run before or after the rest of the pipeline, without writing the
`await next()` dance yourself:

```ts
app.onRequest('request-demo', (context, resolver) => {
  resolver.tryGetService(ILoggerFactory)?.createLogger('request-demo')?.logInformation('incoming');
});

app.onResponse('response-demo', (context) => {
  // runs after everything downstream has completed
});
```

`onRequest` runs your action then `next()`; `onResponse` runs `next()` then your action. Both accept an
optional leading `name` and give the action `(context, serviceResolver)`.

## `split`

Branches the pipeline conditionally. If the check matches, the branch runs *instead of* the rest of the
outer pipeline; otherwise the outer pipeline continues as normal:

```ts
app.split(
  (context) => context.topic === 'special-case',
  (branch) => branch.useFn('special-handling', async (context, next) => { /* ... */ await next(); }),
);
```

`split` accepts either a plain `(context) => boolean` predicate or an `IContextPredicate<TContext>`
(`check(context, serviceResolver)`) when the decision needs container-resolved services.

## `convert`

Converts to a different context type for an inner pipeline, then maps the inner pipeline's result back onto
the outer context — this is how, for example, a transport-specific context is bridged into the shared
`BenzeneMessageContext` pipeline. The conversion contract is `IContextConverter<TContextIn, TContextOut>`:

```ts
export interface IContextConverter<TContextIn, TContextOut> {
  createRequestAsync(contextIn: TContextIn): Promise<TContextOut>;
  mapResponseAsync(contextIn: TContextIn, contextOut: TContextOut): Promise<void>;
}
```

You can supply a converter instance, or the two inline functions, plus either an already-built inner
pipeline or a builder action to configure one:

```ts
app.convert(
  (outer) => new InnerContext(outer),                 // createContextFunc
  (outer, inner) => { outer.result = inner.result; },  // mapContext
  (inner) => useMessageHandlers(inner, MyHandler),     // configure the inner pipeline
);
```

The converter's middleware does **not** call the outer `next` — it converts, runs the inner pipeline, then
maps the response back.

## `useExceptionHandler`

Adds a centralized try/catch around everything after it in the pipeline:

```ts
app.useExceptionHandler((context, error) => {
  // set an error result on the context, e.g. context.result = BenzeneResult.unexpectedError();
});
```

It logs the error (via `ILoggerFactory`, falling back to a null logger) and then invokes your callback with
the context and error — it does not rethrow.

## `MiddlewareRouter<TRequest, TContext>`

An abstract base class (`@benzene/core-middleware`) for building routing middleware that dispatches based on
something extracted from the request/context. You implement three hooks:

```ts
protected abstract tryExtractRequest(context: TContext): TRequest | undefined;
protected abstract canHandle(request: TRequest): boolean;
protected abstract handleFunction(
  request: TRequest,
  context: TContext,
  serviceResolverFactory: IServiceResolverFactory,
): Promise<void>;
```

If `tryExtractRequest` returns `undefined`, or `canHandle` returns `false`, the router calls `next()` so
another piece of middleware gets a chance; otherwise it calls `handleFunction` and does not call `next()`.
Every AWS transport adapter (`SqsLambdaHandler`, `ApiGatewayLambdaHandler`, …) is one of these — each sniffs
the parsed event shape in `canHandle` and claims only its own event source.

## Automatic activity wrapping (`IMiddlewareWrapper`)

`IMiddlewareWrapper` (`@benzene/abstractions-middleware`) is the decorator contract every middleware instance
in every pipeline passes through as it's created:

```ts
export interface IMiddlewareWrapper {
  wrap<TContext>(serviceResolver: IServiceResolver, middleware: IMiddleware<TContext>): IMiddleware<TContext>;
}
```

Any `IMiddlewareWrapper` registered in the container is picked up automatically — you never call `wrap`
yourself. `addDiagnostics()` (`@benzene/diagnostics`) is the working example: it registers
`ActivityMiddlewareWrapper`, which wraps every middleware in an `ActivityMiddlewareDecorator<TContext>` that
starts an OpenTelemetry span named after the inner middleware's `name` and tags it with whatever it can
resolve from the current context:

- `benzene.transport` (from `ICurrentTransport`),
- `benzene.topic` / `benzene.version` (from `IMessageGetter<TContext>`),
- `benzene.handler` (from the handler-definition lookup, by topic).

Because this happens as each middleware is created, it applies uniformly to hand-written middleware, `useFn`
inline middleware, the message router, and everything else — with no per-middleware opt-in. Enable it once,
at startup:

```ts
import { addBenzene } from '@benzene/core-message-handlers';
import { addDiagnostics } from '@benzene/diagnostics';

addBenzene(services);
addDiagnostics(services);
```

## See also

- [Common Middleware](common-middleware.md) — the ready-made middleware Benzene ships (correlation IDs,
  timers, metrics, health checks, message-handler routing, validation).
- [Message Handlers](message-handlers.md) — how the message router and `useMessageHandlers` use this
  pipeline to dispatch to individual handlers.
- [Message Results](message-result.md) — the result type middleware sets on the context.

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
| `src/Benzene.Dependencies` | `@benzene/dependencies` | `Benzene.Microsoft.Dependencies`* |
| `test/Benzene.Core.Test` | `@benzene/core-test` (private) | `Benzene.Core.Test` |

\* Node has no platform DI container equivalent to `Microsoft.Extensions.DependencyInjection`,
so `@benzene/dependencies` ships a first-party `ServiceCollection` /
`DefaultBenzeneServiceContainer` / `DefaultServiceResolverFactory` with the same
singleton/scoped/transient semantics.

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

Next, in dependency order, following the .NET repository:

1. Message routing: `MessageRouter`/`MessageRouterBuilder`, `MessageHandlerMiddleware`,
   request/response mappers, `BenzeneMessageContext` and the handler-pipeline wrapper
2. Remaining `Benzene.Abstractions.Messages` + `Benzene.Core.Messages` surface (senders,
   BenzeneMessage, predicates) and DI registration extensions (`AddBenzene`-style setup)
3. `Benzene.Abstractions.Validation` / validation counterpart
4. Transport adapters (`Benzene.Aws.Lambda.*` for Node Lambda runtimes, `Benzene.Http`, ...)
5. Diagnostics, resilience, clients

## License

MIT — same as the .NET original.

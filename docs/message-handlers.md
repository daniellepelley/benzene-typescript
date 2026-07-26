# Message Handlers

Message handlers are the components that receive and process a single message. There should be exactly
one message handler per topic your service handles. The topic (and the request/response types) form the
front-facing contract for the service — they're what's used to generate OpenAPI / AsyncAPI documentation,
client code, etc.

Handlers support constructor dependency injection, so keep the handler itself thin and push business logic
into an injected service.

## `IMessageHandler<TRequest, TResponse>` / `IMessageHandlerNoResponse<TRequest>`

Defined in `@benzene/abstractions-message-handlers`:

```ts
export interface IMessageHandler<TRequest, TResponse> {
  handleAsync(request: TRequest): Promise<IBenzeneResultOf<TResponse>>;
}

export interface IMessageHandlerNoResponse<TRequest> {
  handleAsync(request: TRequest): Promise<void>;
}
```

- Use `IMessageHandler<TRequest, TResponse>` for request/response handlers — `handleAsync` returns the
  response wrapped in an `IBenzeneResultOf<TResponse>`.
- Use `IMessageHandlerNoResponse<TRequest>` for fire-and-forget handlers with no meaningful response.
  Internally it's wrapped so it still fits the request/response shape; the wrapper reports back an
  **accepted** result once your `handleAsync` completes — which is why a no-response handler always
  produces an "accepted" status.

> **Naming note.** C# overloads the type name `IMessageHandler<TRequest>` on arity; TypeScript can't, so
> the no-response variant is renamed `IMessageHandlerNoResponse<TRequest>`, and `IBenzeneResult<T>` becomes
> `IBenzeneResultOf<T>`. See the README [Porting conventions](../README.md#porting-conventions).

See [Message Results](message-result.md) for everything about `IBenzeneResultOf<T>` and the available
status factories — this page doesn't repeat that detail.

### Request / response example

```ts
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';

@httpEndpoint('POST', '/orders')
@message('order:create', { requestType: CreateOrderMessage, responseType: OrderDto })
export class CreateOrderHandler implements IMessageHandler<CreateOrderMessage, OrderDto> {
  static readonly inject = [IOrderService] as const;
  constructor(private readonly orderService: IOrderService) {}

  handleAsync(request: CreateOrderMessage): Promise<IBenzeneResultOf<OrderDto>> {
    return this.orderService.saveAsync(request);
  }
}
```

The `static readonly inject = [...] as const` array is how a handler declares its constructor
dependencies: the container resolves each identifier and passes it in order. (TypeScript erases parameter
types, so there is no reflective constructor injection — a class with constructor parameters but no
`inject` array can't be resolved, and the container throws a teaching error naming the fix.)

### Fire-and-forget (no response) example

```ts
import { IMessageHandlerNoResponse } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';

@message('order:archive', { requestType: ArchiveOrderMessage })
export class ArchiveOrderHandler implements IMessageHandlerNoResponse<ArchiveOrderMessage> {
  static readonly inject = [IOrderService] as const;
  constructor(private readonly orderService: IOrderService) {}

  async handleAsync(request: ArchiveOrderMessage): Promise<void> {
    await this.orderService.archiveAsync(request);
  }
}
```

## `@message('topic', options)`

Defined in `@benzene/core-message-handlers`:

```ts
export function message(
  topic: string,
  versionOrOptions?: string | { version?: string; requestType?: Constructor; responseType?: Constructor; registry?: MessageHandlersRegistry },
): ClassDecorator;
```

Applied once per handler class. It records the handler's metadata **and self-registers it** with a
`MessageHandlersRegistry` when the module loads (the global registry by default). Options:

- `requestType` / `responseType` — the concrete request/response **classes**. TypeScript erases generics,
  so the runtime needs these to key topics, generate specs, and validate. Use classes, not interfaces — the
  runtime recovers the erased type from the constructor. A handler with no meaningful request/response can
  omit them (they default to `VoidResult`).
- `version` — optional; lets multiple versions of a handler coexist for the same topic. An
  `IVersionSelector` picks which version answers a given request.
- `registry` — an explicit `MessageHandlersRegistry` to register with instead of the global one. Pass a
  local registry when a module (a test, a shared example) shouldn't leak its handlers into global discovery.

> **`@message` vs C# `[Message]`.** The C# attribute is discovered by assembly reflection; the TypeScript
> decorator instead **self-registers** into a `MessageHandlersRegistry` at import time — the Node-idiomatic
> equivalent, since there is no assembly scanning. Importing the module is what makes the handler
> discoverable.

## `@httpEndpoint('METHOD', '/path')`

Defined in `@benzene/http`:

```ts
export function httpEndpoint(method: string, url: string): ClassDecorator;
```

Maps an HTTP method + URL pattern onto a message handler, for any HTTP-shaped transport (Express, AWS API
Gateway). Route parameters like `/orders/{id}` are supported in the pattern. Unlike `@message`, it can be
applied **multiple times** to the same handler class to expose it under more than one route/method. It's
discovered separately from `@message` by an `IHttpEndpointFinder`, which is what HTTP transports use to
route an inbound request to the right topic before handing off to the same message-handler pipeline every
other transport uses.

A handler commonly carries both decorators together, so the same handler answers both an HTTP route and a
direct topic dispatch (e.g. from a queue or another service):

```ts
@httpEndpoint('GET', '/orders/{id}')
@message('order:get', { requestType: GetOrderMessage, responseType: OrderDto })
export class GetOrderHandler implements IMessageHandler<GetOrderMessage, OrderDto> {
  // ...
}
```

> **Request binding caveat.** Benzene binds the JSON **request body** onto your request object. The
> TypeScript port does **not** bind path/query segments onto a *bodyless* request (it can't
> default-construct the erased DTO the way C#'s `Activator.CreateInstance` does), so read client-supplied
> values from the body. A `GET /orders/{id}` route still routes to the handler; the `{id}` segment just
> isn't populated onto the request object.

## Handler discovery (`IMessageHandlersFinder`)

New handlers are found automatically — you don't register them individually. Discovery is layered, mirroring
.NET but keyed off the registry rather than assembly scanning:

- **`RegistryMessageHandlersFinder`** — the counterpart of C#'s `ReflectionMessageHandlersFinder`. It reads
  a `MessageHandlersRegistry` (which the `@message` decorator populated at import time), or an explicit list
  of handler classes, and builds an `IMessageHandlerDefinition` for each (topic, version, request type,
  response type, handler class).
- **`CacheMessageHandlersFinder`** — wraps another finder and caches its results, since discovery is done
  once at startup and reused for every request afterwards.
- **`DependencyMessageHandlersFinder`** — discovers definitions registered directly in the container.
- **`CompositeMessageHandlersFinder`** — combines multiple finders into one, so registry-based and
  container-based discovery can coexist.

`importMessageHandlers(dir)` recursively imports every module in a directory so that decorated handlers
self-register — the Node equivalent of assembly scanning, useful when you want "just point at a folder"
discovery instead of importing each handler class by hand.

## `useMessageHandlers(app, ...handlers)`

Adds the routing middleware to a pipeline (`@benzene/core-message-handlers`). It's a **free function that
takes the pipeline builder as its first argument** (the port's convention for fluent extensions defined
downstream of the builder) and returns it, so it still chains at its own call site:

```ts
import { useMessageHandlers, useMessageHandlersWithRouter } from '@benzene/core-message-handlers';

// Serve specific handler classes (discovery limited to those you pass):
useMessageHandlers(app, CreateOrderHandler, GetOrderHandler);

// Serve everything already registered in the global registry (pass no classes):
useMessageHandlers(app);

// Configure per-handler middleware (e.g. validation) via the router variant:
useMessageHandlersWithRouter(app, (router) => useZodValidation(router), CreateOrderHandler);
```

Every form registers a **`MessageRouter<TContext>`** as the terminal `IMiddleware<TContext>` in the
pipeline. When a message arrives, the router:

1. Extracts the topic via `IMessageGetter<TContext>`. If it's missing, it sets a `validation-error` result
   ("Topic is missing") and returns — no handler lookup happens.
2. Looks up the handler definition for that topic. If none is found, it sets a `not-found` result and returns.
3. Creates the handler via `IMessageHandlerFactory` (resolving it from the container and building its
   per-handler middleware pipeline).
4. Invokes the handler (deferring request-body mapping until the handler needs it) and sets the resulting
   `IMessageHandlerResult` on the context via `IMessageHandlerResultSetter<TContext>`.

The `useMessageHandlersWithRouter` form lets you add middleware that runs **per handler invocation**,
wrapped around the actual call — this is how [validation](validation.md) plugs in: it runs before the
handler and short-circuits with a validation-failure result if the request is invalid, without ever
reaching your handler code.

## Request mapping & content negotiation

`IRequestMapper<TContext>.getBody<TRequest>(context)` resolves the request body: if the context already
carries a typed request it's returned directly; otherwise the raw body string is read via
`IMessageBodyGetter<TContext>` and deserialized. Every transport registers media-format negotiation
(`addMediaFormatNegotiation`), which picks the serializer per request from the `content-type` header
(JSON by default; [XML](common-middleware.md) is available via `@benzene/xml`). `IRequestEnricher<TContext>`
implementations can merge extra context-derived fields onto the deserialized request.

## Response handling

Once your handler returns an `IBenzeneResultOf<TResponse>`, a chain of `IResponseHandler<TContext>`s turns
it into whatever the transport needs:

- A **renderer** serializes the payload (success) or an error payload (failure), choosing the format from
  the negotiated media format. A payload implementing `IRawContentMessage` is delivered verbatim with its
  own content type (useful for a handler that renders its own HTML/body).
- A **status handler** maps the result's status string onto the transport's native status/acknowledgement
  concept (HTTP status code, SQS batch-item-failure, etc. — see
  [Message Results](message-result.md#transport-mapping) for the full table).

## See also

- [Message Results](message-result.md) — `IBenzeneResultOf<T>`, the `BenzeneResult` factory, result
  statuses, and how they map onto transport-specific responses.
- [Middleware](middleware.md) — the pipeline mechanism the `MessageRouter` and per-handler middleware are
  built on.
- [Common Middleware](common-middleware.md) — `useMessageHandlers` and other ready-made pipeline steps.
- [Validation](validation.md) — request validation before a handler is invoked, via Zod/Joi/Yup.
- [Testing Benzene](testing-benzene.md) — testing handlers in isolation and pipelines end-to-end.

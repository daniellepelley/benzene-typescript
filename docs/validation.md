# Validation

Validate a [message handler](message-handlers.md)'s request before the handler runs, short-circuiting the
pipeline with a `validation-error` result when the request is invalid.

## Overview

In the .NET original, request validation ships as two packages — `Benzene.FluentValidation` (wrapping
[FluentValidation](https://docs.fluentvalidation.net/)) and `Benzene.DataAnnotations` (wrapping
`System.ComponentModel.DataAnnotations`). Neither wrapped library has a TypeScript existence, so per the
port's **"third-party integrations are adapted, not reimplemented"** convention (see the README
[Porting conventions](../README.md#porting-conventions)), they are re-created as adapters over the popular
JavaScript validation libraries. This one page replaces both .NET docs, and also covers `@benzenejs/ajv` —
the port of `Benzene.JsonSchema` to [ajv](https://www.npmjs.com/package/ajv), the standard JavaScript JSON
Schema validator — which validates against a raw JSON Schema rather than a code-first schema object.

The shared abstraction stays core (`@benzenejs/abstractions-validation`), and each validator gets its own
adapter package, all four presenting the same register-a-schema / wire-into-the-router shape at the
Benzene seam:

| Package | Adapts | Register a schema | Wire into the router |
|---|---|---|---|
| `@benzenejs/zod` | [Zod](https://www.npmjs.com/package/zod) | `registerZodSchema` | `useZodValidation` |
| `@benzenejs/joi` | [Joi](https://www.npmjs.com/package/joi) | `registerJoiSchema` | `useJoiValidation` |
| `@benzenejs/yup` | [Yup](https://www.npmjs.com/package/yup) | `registerYupSchema` | `useYupValidation` |
| `@benzenejs/ajv` | [JSON Schema (ajv)](https://www.npmjs.com/package/ajv) | `registerJsonSchema` | `useAjvValidation` |

Each adapter adds a single piece of per-handler middleware, `ValidationMiddleware<TRequest, TResponse>`,
to the handler pipeline. For every request:

- **No schema registered for the request type** → the middleware does nothing and calls `next()` (the
  handler runs). Validation is opt-in per request type, exactly like FluentValidation only running when an
  `IValidator<TRequest>` exists.
- **Schema present, request is `null`/`undefined`** → short-circuit with the mapped status (see
  [Failure status mapping](#failure-status-mapping)) and the message `"Request is null"`.
- **Schema present, validation fails** → short-circuit with the mapped status and one error message per
  validation issue. **The handler is never invoked.**
- **Validation passes** → `next()` runs and the handler executes as normal.

A schema plays the role FluentValidation's `IValidator<TRequest>` plays in .NET. Because TypeScript erases
generic type arguments, you can't resolve "the validator for `TRequest`" by runtime type the way C# does;
instead you associate a request **class** (constructor) with a schema in a typed **schema registry**, and
the middleware recovers the request class from the handler's `@message` metadata.

## Prerequisites / Installation

- Node 22+.
- One adapter package, plus its underlying validator (each adapter takes its validator as a real runtime
  dependency — that is the whole point of an adapter package):

```bash
npm install @benzenejs/zod zod
# or
npm install @benzenejs/joi joi
# or
npm install @benzenejs/yup yup
# or
npm install @benzenejs/ajv ajv
```

You can install more than one and mix them across services; a single router usually uses one.

## Basic usage

Three steps: declare a schema, register it against the request **class**, and wire the adapter into the
handler pipeline via [`useMessageHandlersWithRouter`](message-handlers.md#usemessagehandlersapp-handlers)
— the router seam that runs middleware **per handler invocation**, around the actual call.

### Zod

```ts
import { z } from 'zod';
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { message, useMessageHandlersWithRouter } from '@benzenejs/core-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import { registerZodSchema, useZodValidation } from '@benzenejs/zod';

class CreateWidget {
  name: string | undefined;
}
class WidgetCreated {
  id: string | undefined;
}

// The Zod schema plays the role of FluentValidation's IValidator<CreateWidget>.
registerZodSchema(CreateWidget, z.object({ name: z.string().max(10) }));

@message('widget:create', { requestType: CreateWidget, responseType: WidgetCreated })
export class CreateWidgetHandler implements IMessageHandler<CreateWidget, WidgetCreated> {
  handleAsync(request: CreateWidget): Promise<IBenzeneResultOf<WidgetCreated>> {
    const payload = new WidgetCreated();
    payload.id = `widget-${request.name}`;
    return Promise.resolve(BenzeneResult.created(payload));
  }
}

// Wire validation into the handler pipeline (app is your MessageRouter builder / pipeline builder):
useMessageHandlersWithRouter(app, (router) => useZodValidation(router), CreateWidgetHandler);
```

If `CreateWidget.name` is longer than 10 characters, `CreateWidgetHandler.handleAsync` is never called and
the caller receives a `validation-error` result carrying Zod's issue messages.

### Joi

The same shape — only the schema library changes:

```ts
import Joi from 'joi';
import { registerJoiSchema, useJoiValidation } from '@benzenejs/joi';

registerJoiSchema(CreateWidget, Joi.object({ name: Joi.string().max(10) }));

useMessageHandlersWithRouter(app, (router) => useJoiValidation(router), CreateWidgetHandler);
```

### Yup

```ts
import * as yup from 'yup';
import { registerYupSchema, useYupValidation } from '@benzenejs/yup';

registerYupSchema(CreateWidget, yup.object({ name: yup.string().max(10) }));

useMessageHandlersWithRouter(app, (router) => useYupValidation(router), CreateWidgetHandler);
```

### JSON Schema (ajv)

`@benzenejs/ajv` is the raw-JSON-Schema member of the family. Reach for it when the contract you validate
against is an externally-authored or shared JSON Schema document, rather than a code-first schema object
you build in TypeScript. Register a hand-authored JSON Schema against the request class, and wire it in the
same way:

```ts
import { registerJsonSchema, useAjvValidation } from '@benzenejs/ajv';

registerJsonSchema(CreateWidget, {
  type: 'object',
  properties: { name: { type: 'string', maxLength: 10 } },
  required: ['name'],
});

useMessageHandlersWithRouter(app, (router) => useAjvValidation(router), CreateWidgetHandler);
```

The schema is compiled once by [ajv](https://www.npmjs.com/package/ajv) at registration, so an invalid
schema surfaces then rather than on the first request; a failing request yields one `validation-error`
message per ajv error, each prefixed with the JSON Pointer of the failing value (e.g.
`"/name: must NOT have more than 10 characters"`).

Two things differ from the .NET `Benzene.JsonSchema` it ports (both recorded in the README
[Porting conventions](../README.md#porting-conventions)):

- **Handler-level, not raw-body.** It validates the already-deserialized `context.request` — exactly like
  the Zod/Joi/Yup adapters — not the raw request body pre-deserialization the way .NET's
  `JsonSchemaMiddleware` does. The port has no raw-body validation seam, so there are no
  `MissingBody`/`MalformedBody` results; a malformed body fails earlier, during deserialization.
- **No generate-from-type.** .NET generates a schema by reflecting over the request CLR type; TypeScript
  erases types at runtime, so schemas are always supplied explicitly via `registerJsonSchema`. A request
  type with no registered schema is simply not validated.

Like the other adapters, `useAjvValidation` also registers an `ITypeJsonSchemaSource`
(`AjvJsonSchemaSource`) that publishes the registered schema to the service's spec/mesh descriptor — since
it is already JSON Schema, the schema is embedded as-is.

`use<Lib>Validation(router)` does two things, mirroring `.UseFluentValidation()`:

1. Registers a `DefaultValidationStatusMapper` as the `IValidationStatusMapper` if one isn't already
   registered (via `tryAddSingleton` — the first registration wins, so you can supply your own first).
2. Adds the adapter's `ValidationMiddlewareBuilder` to the handler pipeline, which builds a
   `ValidationMiddleware` per handler invocation, resolving that handler's schema from the registry.

Because it is per-handler middleware, adding it once validates **every** handler in that router that has a
schema registered for its request type — there's no per-handler opt-in step. Handlers without a registered
schema simply pass through unvalidated.

## The schema registry

`register<Lib>Schema(RequestClass, schema)` associates a request **class** with the schema that validates
its instances, on a process-wide global registry. This replaces FluentValidation's
`services.AddSingleton<IValidator<TRequest>, ...>()` — the erased request type is recovered from the
handler's `@message` `requestType`, then looked up here.

The binding is **typed**: the schema's inferred/static type is checked against the request class, so a
schema for an unrelated shape is a compile error — recovering the compile-time link
`IValidator<TRequest>` gave for free in .NET:

```ts
class TypedRequest {
  name?: string;
}

registerZodSchema(TypedRequest, z.object({ name: z.string() })); // ok
registerZodSchema(TypedRequest, z.object({ name: z.number() })); // compile error
```

> **Where does `RequestClass` come from?** The handler's `@message` decorator declares
> `requestType: CreateWidget`. Under type erasure the runtime needs that concrete class to key the topic,
> generate specs, and — here — find the schema. See
> [Message Handlers](message-handlers.md#messagetopic-options); a handler with no `requestType` has nothing
> to validate against, so the middleware falls through to `next()`.

For tests (or any module that shouldn't leak into global discovery), construct an isolated registry
instance instead of using the global one:

```ts
import { ZodSchemaRegistry } from '@benzenejs/zod';

const registry = new ZodSchemaRegistry();
registry.register(CreateWidget, z.object({ name: z.string().max(10) }));
registry.get(CreateWidget); // the schema; does not affect the global registry
```

`@benzenejs/ajv` follows the same registry pattern under different names: `registerJsonSchema(RequestClass,
schema)` on the global registry, or a standalone `AjvSchemaRegistry` for tests. Its binding is **not**
type-checked against the request class the way the code-first adapters' are — a JSON Schema is a runtime
document, not a schema object carrying a static type — so a schema that doesn't match the request shape is
caught at request time, not compile time.

## Where validation sits in the pipeline

`ValidationMiddleware` is an `IHandlerMiddlewareBuilder` added inside the `router` callback passed to
`useMessageHandlersWithRouter` — the same place a handler's request/response types have already been
resolved, and it runs **before** the handler. Compose it alongside other per-handler middleware:

```ts
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { BenzeneMessageContext } from '@benzenejs/core-messages';
import {
  addBenzeneMessage,
  BenzeneMessageApplication,
  useMessageHandlersWithRouter,
} from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { useZodValidation } from '@benzenejs/zod';

const container = new DefaultBenzeneServiceContainer();
addBenzeneMessage(container);

const builder = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
useMessageHandlersWithRouter(builder, (router) => useZodValidation(router), CreateWidgetHandler);

const app = new BenzeneMessageApplication(builder.build());
```

Sending `{ "name": "foo" }` routes to the handler and returns `ok`/`created`; sending
`{ "name": "foo-bar-foo-bar" }` short-circuits with `validation-error` and the handler never runs — this is
exactly the behavior the adapters' pipeline tests assert.

> **Don't stack two adapters on the same router** unless you deliberately want a request checked twice —
> each adapter registers its own `ValidationMiddleware` and both would run.

## Failure status mapping

By default a failed validation maps to `BenzeneResultStatus.validationError` (the `validation-error` wire
status — a `422` over HTTP; see [Message Results](message-result.md#transport-mapping)). The status is
resolved through `IValidationStatusMapper.getStatus(handlerType, requestType, result)`, implemented by
`DefaultValidationStatusMapper` (in `@benzenejs/abstractions-validation`, shared by all three adapters),
which checks, in order:

1. **Per-handler status** — if the handler class carries a `@validationStatus('...')` decorator, that
   status is used.
2. **Default** — otherwise `BenzeneResultStatus.validationError`.

Override the status for a specific handler with the `@validationStatus` decorator:

```ts
import { validationStatus } from '@benzenejs/abstractions-validation';
import { BenzeneResultStatus } from '@benzenejs/results';

@validationStatus(BenzeneResultStatus.forbidden)
@message('widget:create', { requestType: CreateWidget, responseType: WidgetCreated })
export class CreateWidgetHandler implements IMessageHandler<CreateWidget, WidgetCreated> {
  // A validation failure on CreateWidget now returns `forbidden` instead of `validation-error`.
}
```

To use a custom mapper, register your own `IValidationStatusMapper` before calling
`use<Lib>Validation(...)` — registration uses `tryAddSingleton`, so the first one wins.

> **Port note.** FluentValidation's *per-rule* `.WithStatus(...)` override (a `ValidationFailure.CustomState`
> carrying a status) is a FluentValidation-specific feature with no schema-library-neutral equivalent, so
> it is **not** ported. Only the handler-level `@validationStatus` branch and the default branch exist. Set
> a rule-specific outcome inside your schema instead (e.g. a Zod refinement), or use `@validationStatus`
> for a per-handler status.

## Client-side validation

Each adapter also ships a `ValidationClientMiddleware<TRequest, TResponse>` that applies the same
"resolve schema → validate → short-circuit on failure" behavior to **outgoing** Benzene client calls
(`IBenzeneClientContext<TRequest, TResponse>`) rather than incoming handler requests. On the client side
there is no handler to recover the request type from, so the schema is resolved from the outgoing
**message instance's own constructor** against the registry:

```ts
import { ValidationClientMiddleware } from '@benzenejs/zod';

const middleware = new ValidationClientMiddleware<CreateWidget, WidgetCreated>();
```

Client-side failures always map to `BenzeneResultStatus.validationError` — the per-handler
`@validationStatus` mapping applies only to the handler-side `ValidationMiddleware`, matching the .NET
client middleware. There is no `use<Lib>ValidationClient` free function yet: the port has no pipeline
builder that consumes an `IBenzeneClientContextMiddlewareBuilder`, so `ValidationClientMiddlewareBuilder`
is exported for manual wiring, and the `use...` helper will be added once a client router exposes it.

## Choosing (and the behavioral differences)

The three adapters are interchangeable at the Benzene seam — the difference is the validator you already
know and the shape of its API:

| | Zod | Joi | Yup | JSON Schema (ajv) |
|---|---|---|---|---|
| Schema builder | `z.object({ ... })` | `Joi.object({ ... })` | `yup.object({ ... })` | a JSON Schema object (`{ type: 'object', ... }`) |
| Validation call | `schema.safeParse` (sync) | `schema.validate(..., { abortEarly: false })` (sync) | `await schema.validate(..., { abortEarly: false })` (async) | `validate(request)` (sync, pre-compiled) |
| Reports failure by | returning `{ success: false, error }` | returning `{ error }` | **throwing** a `ValidationError` | returning `false`, errors on `validate.errors` |
| Message source | `error.issues[].message` | `error.details[].message` | `inner[].message` | `errors[].message` |
| `field` source | `issues[].path` (as a JSON Pointer) | `details[].path` (as a JSON Pointer) | `inner[].path` (yup's dotted path) | `errors[].instancePath` (already a pointer) |
| `code` source | `issues[].code` (`too_big`, …) | `details[].type` (`string.max`, …) | `inner[].type` (`max`, …) | `errors[].keyword` (`maxLength`, …) |

The adapters normalize all of this: whichever you pick, a failure becomes a `validation-error` result
carrying one **structured error** per issue — the message, the field it came from, and the identifier
of the rule that rejected it — and the handler is skipped. A caller therefore does not need to know
which validator a service happens to use in order to attach an error to the right input.

`field` is the validator's own path, verbatim, which is why ajv reports a JSON Pointer and yup a
dotted path; where the validator reports a path as an array with no native string form (Zod, Joi) the
adapters render an RFC 6901 JSON Pointer. Pick the library your team already uses; if
you have no preference, Zod's static type inference pairs most naturally with the port's typed schema
registry, and `@benzenejs/ajv` fits best when the contract is a shared or externally-authored JSON Schema
rather than something you'd hand-write in TypeScript.

## Not ported (yet)

- **Schema / OpenAPI generation via `IValidationSchemaBuilder`.** `Benzene.FluentValidation`'s
  `IValidationSchemaBuilder` (`FluentValidationSchemaBuilder`) has only its abstraction ported
  (`IValidationSchemaBuilder` and the `IValidationSchema` family live in `@benzenejs/abstractions-validation`);
  no adapter ships a concrete builder for that specific shape yet. **Schema generation itself is delivered
  through a different seam, though:** the Zod / Joi / Yup / ajv adapters each ship a concrete
  `ITypeJsonSchemaSource` (`ZodJsonSchemaSource` / `JoiJsonSchemaSource` / `YupJsonSchemaSource` /
  `AjvJsonSchemaSource`) that converts the validation schema — rules included
  (`minLength`/`maxLength`/`pattern`/`enum`/`format`) — to JSON Schema (`AjvJsonSchemaSource` publishes the
  registered schema as-is), which `@benzenejs/schema-openapi`'s `useSpec` publishes. So a validated handler's payload
  schema is documented automatically; see [Serialization](serialization.md) and `@benzenejs/schema-openapi`.
- **Custom string rule extensions.** FluentValidation's `Benzene.FluentValidation.Common` helpers
  (`IsGuid()`, `IsOneOf(...)`, `IsJson()`, ...) are not re-created — Zod, Joi, and Yup each provide these
  as native schema methods/refinements, so use the validator's own idioms.
- **DataAnnotations-style attribute validation.** The .NET `Benzene.DataAnnotations` "always validate the
  request object's attributes, no registration" model has no direct analog; declare a schema and register
  it instead.

## See also

- [Message Handlers](message-handlers.md) — where validation middleware sits in the request lifecycle, and
  the `useMessageHandlersWithRouter` seam it plugs into.
- [Message Results](message-result.md) — `IBenzeneResultOf<T>`, the `validation-error` status, and how it
  maps onto transport responses (HTTP `422`, queue nack, ...).
- [Middleware](middleware.md) — the pipeline mechanism the per-handler validation middleware runs inside.
- [Getting Started](getting-started.md) — build and run a first Benzene service end to end.
- README [Porting conventions](../README.md#porting-conventions) — the "third-party integrations are
  adapted, not reimplemented" rule these adapters follow.

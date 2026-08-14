# Zod Validation with Custom Rules

Write the validation real handlers actually need — cross-field checks, reusable string formats, and
per-handler status overrides — with [Zod](https://zod.dev/) and `@benzenejs/zod`, and know exactly where
an async "is this already taken?" check has to live in the TypeScript port.

## Problem Statement

[Validation](../validation.md) covers the mechanics of wiring a schema adapter into the pipeline and the
basics of `@validationStatus`. This cookbook goes further, into validation that production handlers reach
for:

- A rule that compares two properties on the same request (an end date must be after a start date).
- Benzene-neutral string formats — a UUID SKU, an alphanumeric name — expressed with Zod's own built-ins.
- A "this name is already taken" check that has to call a database asynchronously — and a **real gotcha**:
  the port's validation middleware validates **synchronously**, so an async rule cannot live in the schema.
  You need to know that before you build around it.
- Mapping a specific business rule to a specific result status — a duplicate name should come back as
  `409 conflict`, not the generic `422 validation-error` every other failure gets.

> **Port note (read this first).** The .NET original of this cookbook uses FluentValidation, whose
> `MustAsync` and per-rule `.WithStatus(...)` have no schema-library-neutral equivalent. `@benzenejs/zod`
> adapts Zod instead, and Zod's per-rule status override and async-in-the-pipeline both differ from
> FluentValidation. Where they differ, this cookbook uses the TypeScript shape and says so — it is not a
> line-by-line transliteration of the .NET recipe.

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and a Benzene service — see [Getting Started](../getting-started.md).
- A message handler and request type already defined — see [Message Handlers](../message-handlers.md).
- `useZodValidation` already wired into your handler pipeline — see
  [Validation → Basic usage](../validation.md#basic-usage) for the base setup this builds on.

## Installation

```bash
npm install @benzenejs/zod zod
```

`@benzenejs/zod` takes `zod` as a real runtime dependency — that is the whole point of an adapter package.

## Step-by-Step Implementation

### 1. The request, the port, and the handler

The handler depends on a repository behind a service token (the port's convention for anything resolved
from the container — see [Message Handlers](../message-handlers.md)):

```ts
// ProductRepository.ts
import { ServiceToken, serviceToken } from '@benzenejs/abstractions';

export interface IProductRepository {
  nameExistsAsync(name: string): Promise<boolean>;
  createAsync(name: string, sku: string): Promise<string>;
}

// The interface and the constant share a name (declaration merging): `IProductRepository` is both the
// type and the runtime identifier the container resolves.
export const IProductRepository: ServiceToken<IProductRepository> =
  serviceToken<IProductRepository>('IProductRepository');
```

```ts
// CreateProductHandler.ts (request/response)
export class CreateProductRequest {
  name?: string;
  sku?: string;
  launchDate?: string;       // ISO-8601 date-time
  discontinueDate?: string;  // ISO-8601 date-time, optional
}

export class CreateProductResponse {
  id?: string;
}
```

### 2. Cross-field validation with `.superRefine`

A rule that compares two properties on the same request is a **refinement** in Zod: `.refine` for a single
boolean check, `.superRefine` when you want to attach the error to a specific field with a specific
message. `.superRefine`'s `ctx.addIssue({ path: [...] })` is the Zod equivalent of FluentValidation's
`.WithName(...)` — it decides which property the error is reported against:

```ts
import { z } from 'zod';

const createProductSchema = z
  .object({
    name: z.string().min(1).max(50),
    sku: z.string(),
    launchDate: z.iso.datetime(),
    discontinueDate: z.iso.datetime().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.discontinueDate !== undefined && value.discontinueDate <= value.launchDate) {
      ctx.addIssue({
        code: 'custom',
        message: 'discontinueDate must be after launchDate',
        path: ['discontinueDate'],
      });
    }
  });
```

Because ISO-8601 date-time strings sort lexically in chronological order, the `<=` comparison on the raw
strings is correct without parsing to `Date`.

### 3. Reusable string formats — Zod's own built-ins

FluentValidation ships `IsGuid()`, `IsAlphaNumericAndSymbols(...)` etc. in `Benzene.FluentValidation.Common`.
The Zod adapter does **not** re-create those — Zod already provides them as native schema methods, so you
use Zod's idioms directly (this is a documented port decision; see
[Validation → Not ported](../validation.md#not-ported-yet)):

```ts
import { z } from 'zod';

const createProductSchema = z
  .object({
    // letters, digits, spaces and hyphens only — the alphanumeric-and-symbols rule, in Zod
    name: z.string().min(1).max(50).regex(/^[A-Za-z0-9 -]+$/),
    // a UUID SKU — Zod's built-in format check, replacing IsGuid()
    sku: z.uuid(),
    launchDate: z.iso.datetime(),
    discontinueDate: z.iso.datetime().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.discontinueDate !== undefined && value.discontinueDate <= value.launchDate) {
      ctx.addIssue({ code: 'custom', message: 'discontinueDate must be after launchDate', path: ['discontinueDate'] });
    }
  });
```

Each failed built-in contributes one issue, and `ValidationMiddleware` turns each issue's `message` into
one `validation-error` message — exactly the `error.issues[].message` mapping documented in
[Validation → Choosing](../validation.md#choosing-and-the-behavioral-differences).

### 4. The async "already exists" check — where it has to live, and why

Here is the gotcha. You might reach for an async refinement:

```ts
// DON'T: this throws at request time, it does not validate.
z.string().refine(async (name) => !(await repo.nameExistsAsync(name)));
```

`ValidationMiddleware` in `@benzenejs/zod` calls `schema.safeParse(context.request)` — the **synchronous**
parse. Zod throws `Encountered Promise during synchronous parse. Use .parseAsync() instead` the moment a
schema contains an async refinement. The port has no async-validation seam, so **an async rule cannot go in
the validation schema at all.**

This is the TypeScript counterpart of the .NET cookbook's discovery that FluentValidation's `MustAsync`
validators crash `AddFluentValidation`'s startup scan. Same lesson, different mechanism: **keep
I/O-bound checks out of validation.** Do the uniqueness check in the handler, where you are already
`async`, and return the right result status directly:

```ts
// CreateProductHandler.ts
import { z } from 'zod';
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { message } from '@benzenejs/core-message-handlers';
import { httpEndpoint } from '@benzenejs/http';
import { BenzeneResult, BenzeneResultStatus } from '@benzenejs/results';
import { registerZodSchema } from '@benzenejs/zod';
import { IProductRepository } from './ProductRepository.js';

export class CreateProductRequest {
  name?: string;
  sku?: string;
  launchDate?: string;
  discontinueDate?: string;
}
export class CreateProductResponse {
  id?: string;
}

const createProductSchema = z
  .object({
    name: z.string().min(1).max(50).regex(/^[A-Za-z0-9 -]+$/),
    sku: z.uuid(),
    launchDate: z.iso.datetime(),
    discontinueDate: z.iso.datetime().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.discontinueDate !== undefined && value.discontinueDate <= value.launchDate) {
      ctx.addIssue({ code: 'custom', message: 'discontinueDate must be after launchDate', path: ['discontinueDate'] });
    }
  });

// The typed binding: the schema's inferred type is checked against the request class.
registerZodSchema(CreateProductRequest, createProductSchema);

@httpEndpoint('POST', '/products')
@message('product:create', { requestType: CreateProductRequest, responseType: CreateProductResponse })
export class CreateProductHandler
  implements IMessageHandler<CreateProductRequest, CreateProductResponse>
{
  static readonly inject = [IProductRepository] as const;
  constructor(private readonly repository: IProductRepository) {}

  async handleAsync(
    request: CreateProductRequest,
  ): Promise<IBenzeneResultOf<CreateProductResponse>> {
    // Synchronous, schema-shaped validation has already passed by the time the handler runs.
    // The async, I/O-bound check lives here:
    if (await this.repository.nameExistsAsync(request.name!)) {
      return BenzeneResult.set<CreateProductResponse>(BenzeneResultStatus.conflict);
    }

    const id = await this.repository.createAsync(request.name!, request.sku!);
    const response = new CreateProductResponse();
    response.id = id;
    return BenzeneResult.created(response);
  }
}
```

### 5. Returning `409 conflict` for the duplicate-name rule

A duplicate name is a business-rule conflict, not a generic validation error. In step 4 the handler returns
it explicitly with `BenzeneResult.set(BenzeneResultStatus.conflict, ...)` — there is no `conflict` shorthand
on `BenzeneResult`, so use the general `set(status, payload?, isSuccessful?)` factory (pass `false` because
`conflict` is a failure status). Over HTTP, `conflict` maps to a real `409` response; see
[Message Results → Transport mapping](../message-result.md#transport-mapping).

Why the handler and not the schema? Because the port maps a **handler's** validation status, not a
per-rule one. `@validationStatus` on the handler class overrides the status for **every** validation
failure that handler produces — it cannot single out one rule the way FluentValidation's per-rule
`.WithStatus(...)` does (that FluentValidation feature is
[not ported](../validation.md#failure-status-mapping)). So:

- **Schema-shaped, structural failures** (bad UUID, name too long, discontinue-before-launch) → the schema,
  short-circuited by the middleware as `validation-error` (or the handler's `@validationStatus`, applied
  uniformly).
- **The one rule that needs its own status** (duplicate name → `conflict`) → the handler.

If instead you want *all* of a handler's schema failures to map to one non-default status, that is exactly
what `@validationStatus` is for:

```ts
import { validationStatus } from '@benzenejs/abstractions-validation';
import { BenzeneResultStatus } from '@benzenejs/results';

@validationStatus(BenzeneResultStatus.badRequest) // every schema failure on this handler → bad-request
@message('product:create', { requestType: CreateProductRequest, responseType: CreateProductResponse })
export class CreateProductHandler { /* ... */ }
```

### 6. Wire it into the pipeline

`useZodValidation` plugs into the per-handler router seam,
[`useMessageHandlersWithRouter`](../validation.md#basic-usage). Added once, it validates every handler in
that router that has a schema registered for its request type:

```ts
useMessageHandlersWithRouter(app, (router) => useZodValidation(router), CreateProductHandler);
```

## Testing

Drive the whole thing — schema short-circuit, handler conflict — through the transport-neutral message
pipeline with `@benzenejs/testing`, so routing, body binding, validation, and the handler all run. Register a
fake `IProductRepository` to control the "already exists" branch:

```ts
// CreateProductHandler.test.ts
import { describe, expect, it } from 'vitest';
import { BenzeneMessageContext } from '@benzenejs/core-messages';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { BenzeneResultStatus } from '@benzenejs/results';
import {
  addBenzene,
  addBenzeneMessage,
  BenzeneMessageApplication,
  useMessageHandlersWithRouter,
} from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { useZodValidation } from '@benzenejs/zod';
import { messageBuilder, asBenzeneMessage } from '@benzenejs/testing';
import { randomUUID } from 'node:crypto';
import { CreateProductHandler } from './CreateProductHandler.js';
import { IProductRepository } from './ProductRepository.js';

function buildApp(repo: IProductRepository) {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addBenzeneMessage(container);
  container.addScopedInstance(IProductRepository, repo);

  const builder = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
  useMessageHandlersWithRouter(builder, (router) => useZodValidation(router), CreateProductHandler);
  return {
    app: new BenzeneMessageApplication(builder.build()),
    resolver: container.createServiceResolverFactory(),
  };
}

describe('CreateProductHandler', () => {
  it('short-circuits with validation-error when the SKU is not a UUID', async () => {
    const { app, resolver } = buildApp({
      nameExistsAsync: () => Promise.resolve(false),
      createAsync: () => Promise.resolve('p1'),
    });

    const request = asBenzeneMessage(
      messageBuilder('product:create', {
        name: 'Widget',
        sku: 'not-a-uuid',
        launchDate: new Date().toISOString(),
      }),
    );
    const response = await app.handleAsync(request, resolver);

    expect(response.statusCode).toBe(BenzeneResultStatus.validationError);
  });

  it('returns conflict when the name already exists (the async, handler-side rule)', async () => {
    const { app, resolver } = buildApp({
      nameExistsAsync: () => Promise.resolve(true),
      createAsync: () => Promise.resolve('p1'),
    });

    const request = asBenzeneMessage(
      messageBuilder('product:create', {
        name: 'Widget',
        sku: randomUUID(),
        launchDate: new Date().toISOString(),
      }),
    );
    const response = await app.handleAsync(request, resolver);

    expect(response.statusCode).toBe(BenzeneResultStatus.conflict);
  });
});
```

`response.statusCode` is a `BenzeneResultStatus` string, identical byte-for-byte across languages — assert
against the constant, not `'conflict'` (see [Message Results](../message-result.md)).

## Troubleshooting

### `Encountered Promise during synchronous parse` at request time

Your schema contains an async `.refine`/`.superRefine`. The port's `ValidationMiddleware` uses the
synchronous `safeParse`, so async refinements are unsupported. Move that check into the handler (step 4) —
it's already `async` there.

### The duplicate-name rule returns `422 validation-error`, not `409 conflict`

You put the uniqueness check in the schema (or relied on `@validationStatus`, which maps *every* failure of
the handler). Return the conflict from the **handler** with
`BenzeneResult.set(BenzeneResultStatus.conflict, ...)`, as in step 4 — per-rule statuses are not part of the
port.

### `registerZodSchema(Request, schema)` doesn't compile

The schema's inferred type doesn't line up with the request class — the port's binding is **typed** on
purpose (see [Validation → The schema registry](../validation.md#the-schema-registry)). Make the request
class's fields match the schema (e.g. all-optional `string` fields for an all-`z.string()` object), or fix
the schema.

### The schema never runs / the handler validates nothing

`useZodValidation` must be inside the `useMessageHandlersWithRouter` router callback (step 6), and the
schema must be registered against the **exact** request class the handler's `@message` declares as
`requestType`. A handler with no registered schema simply passes through unvalidated.

## Variations

### Isolate the registry in a test

`registerZodSchema` writes to a process-wide global. To avoid leaking a schema into other modules' global
discovery, build an isolated `ZodSchemaRegistry` instead — see
[Validation → The schema registry](../validation.md#the-schema-registry).

### Keep format rules reusable

Extract the structural object schema into a shared constant and layer the cross-field `.superRefine` on top
per handler, so several handlers can reuse the same field-format rules — the Zod analog of the .NET
cookbook's `Include(...)` split, using plain composition.

## Further Reading

- [Validation](../validation.md) — the adapter mechanics, the schema registry, and failure status mapping
  this cookbook builds on.
- [Message Handlers](../message-handlers.md) — `@message`, `IMessageHandler`, and the `static inject`
  convention.
- [Message Results](../message-result.md) — `IBenzeneResultOf<T>`, `conflict`/`validation-error`, and how
  each maps onto a transport response.
- [Testing Benzene](../testing-benzene.md) — the full in-process testing surface.
- [Mocking External Dependencies](mocking-dependencies.md) — swapping the repository for a fake through the
  pipeline.

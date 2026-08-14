# Correlation Ids

> Cross-service correlation is handled by automatic W3C `traceparent` propagation
> (`useW3CTraceContext(app)`, in `@benzenejs/diagnostics`), which continues a distributed trace from the
> incoming `traceparent` header on every transport. See
> [Common Middleware](common-middleware.md) for that surface. This page covers the smaller,
> still-useful `ICorrelationId` — a per-invocation marker you can put in your logs and forward to
> downstream calls.

## Overview

`ICorrelationId` (`@benzenejs/abstractions`) tracks a single correlation id for the current
invocation. It is a scoped service — one instance per request — with two methods:

```ts
export interface ICorrelationId {
  set(correlationId: string): void;
  get(): string;
}
```

The default implementation, `CorrelationId` (`@benzenejs/diagnostics`), self-generates a value with
`crypto.randomUUID()` when it is constructed, so `get()` always returns a non-empty id even if
nothing ever calls `set()`. That makes it a zero-configuration per-invocation marker for logs.
`set()` only overwrites the id with a non-empty value — passing `''` or `undefined` leaves the
generated id in place.

> This is the TypeScript equivalent of .NET's `Guid.NewGuid().ToString()` seed: `crypto.randomUUID()`
> (from the built-in `node:crypto`) produces an RFC 4122 v4 UUID in the same canonical string form.

## Installation

```bash
npm install @benzenejs/diagnostics
```

`ICorrelationId` itself lives in `@benzenejs/abstractions` (already a transitive dependency of the
core packages); `@benzenejs/diagnostics` supplies the `CorrelationId` implementation and the
registration/log-scope helpers.

## Adding the correlation id to your logs

The correlation extensions are exported under the `CorrelationExtensions` namespace (TypeScript has
no extension methods, so the C# `Extensions` static class becomes a namespaced set of free
functions). `withCorrelationId` attaches the current `correlationId` to the request's logging scope,
registering the `CorrelationId` service for the pipeline if it is not already:

```ts
import { CorrelationExtensions } from '@benzenejs/diagnostics';

app.useLogResult((x) => CorrelationExtensions.withCorrelationId(x));
```

`useLogResult` is a pipeline-builder member; the action it passes you is an
`ILogContextBuilder<TContext>`, and `withCorrelationId` adds a `correlationId` field to every log
scope created for the rest of the pipeline. With nothing populating it, the id is the
self-generated UUID — a stable marker that ties together all the log lines of one invocation.

## Populating it from a custom source

To seed the id from your own source (for example, a partner's proprietary request-id header),
register the service with `addCorrelationId` at startup and call `ICorrelationId.set(...)` from your
own middleware:

```ts
import { IBenzeneServiceContainer, ICorrelationId } from '@benzenejs/abstractions';
import { BenzeneConfiguration, BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { IMessageHeadersGetter } from '@benzenejs/abstractions-messages';
import { addBenzene } from '@benzenejs/core-message-handlers';
import { AwsLambdaHost, useAwsLambda } from '@benzenejs/aws-lambda-core';
import { CorrelationExtensions } from '@benzenejs/diagnostics';

export class StartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    addBenzene(services);
    CorrelationExtensions.addCorrelationId(services);
  }

  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useAwsLambda(app, (aws) => {
      aws.useFn('PartnerCorrelation', async (context, next, resolver) => {
        const headers = resolver.getService(IMessageHeadersGetter) as unknown as IMessageHeadersGetter<typeof context>;
        const partnerId = CorrelationExtensions.getHeader(headers, context, 'x-partner-request-id');
        resolver.getService(ICorrelationId).set(partnerId);
        await next();
      });
      // ... the rest of your pipeline (useApiGateway(aws, ...) / useSqs(aws, ...) / ...)
    });
  }
}

export const handler = new AwsLambdaHost(StartUp).lambdaHandler;
```

`getHeader(headersGetter, context, keys)` is the ported header lookup: it matches header keys
**case-insensitively**, skips empty values, and — when given a list — returns the first key that is
present, in the order you give them. It returns `''` when none match, which `set()` then ignores,
so the self-generated id survives a missing header:

```ts
// try a partner header first, then fall back to a standard one
const id = CorrelationExtensions.getHeader(headers, context, ['x-partner-request-id', 'x-correlation-id']);
```

Because `addCorrelationId` registers the service as **scoped**, each invocation gets its own
`CorrelationId`, so setting it in one request never bleeds into another.

## Forwarding it to outbound calls

An outbound message client can stamp the current invocation's correlation id onto every request it
sends. `withCorrelationId` on a `ClientBuilder` (`@benzenejs/clients`) wraps the client in a decorator
that copies `ICorrelationId.get()` into the outgoing headers before delegating:

```ts
import { withCorrelationId } from '@benzenejs/clients';

// on your outbound client builder
withCorrelationId(clientBuilder);
```

By default the value is written under the `correlationId` header key; the underlying
`CorrelationIdBenzeneMessageClient` takes an optional third constructor argument to use a different
key. Existing headers on the request are preserved — only the correlation header is added.

> The default key is `correlationId` (not the `x-correlation-id` string the .NET docs mention); pass
> a custom key to the `CorrelationIdBenzeneMessageClient` constructor if you need a specific wire
> header.

## See Also

- [Common Middleware](common-middleware.md) — W3C `traceparent` propagation (`useW3CTraceContext`)
  and the other ready-made middleware.
- [Middleware](middleware.md) — writing the custom `useFn` middleware used above.
- [Cookbooks](cookbooks/README.md) — end-to-end recipes, including request correlation.
- [Porting conventions](../README.md#porting-conventions) — how C# `Guid`/`AsyncLocal`/extension
  methods map to the TypeScript shapes shown here.

# Centralized Error Handling Across a Benzene Pipeline

Catch unhandled errors in one place, log them consistently, and map them onto a sensible response for
every transport instead of letting each handler roll its own `try`/`catch`.

## Problem Statement

Individual message handlers throwing unhandled errors leads to inconsistent behavior across transports:
an Express/API Gateway request might blow up with an unstructured 500, while an SQS consumer might crash
the whole batch instead of failing just the one message. You want:

- A single place to catch errors thrown anywhere downstream in a pipeline.
- Consistent logging of the error (so you're not relying on every handler author to remember to log).
- A transport-appropriate response: an HTTP-based transport should return a proper status code and body;
  a batch transport like SQS should report only the failed message back to the queue, not the whole
  batch.
- No internal detail (stack traces, driver error strings) leaking to the client.

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and a Benzene service with at least one pipeline built via
  `IMiddlewarePipelineBuilder<TContext>` (any transport) — see [Middleware](../middleware.md).
- `@benzene/core-middleware`, which is already a dependency of `@benzene/core-message-handlers` and
  every transport package — no extra install is needed for the middleware itself.

## Installation

No new package is required — `useExceptionHandler` is a member of `IMiddlewarePipelineBuilder<TContext>`
(`@benzene/abstractions-middleware`), implemented once in `MiddlewarePipelineBuilderBase`
(`@benzene/core-middleware`), which every Benzene transport package already depends on. For the HTTP
example below you'll also use `@benzene/results` (`ErrorPayload`, `BenzeneResultStatus`), a dependency of
any HTTP-based transport package.

```bash
npm install @benzene/aws-lambda
```

## What `useExceptionHandler` actually does

`useExceptionHandler` is declared on the pipeline builder as:

```ts
useExceptionHandler(
  onException: (context: TContext, error: unknown) => void,
): IMiddlewarePipelineBuilder<TContext>;
```

It registers an `ExceptionHandlerMiddleware<TContext>` that wraps everything registered **after** it in a
`try`/`catch`. Its exact behavior, read straight from
`src/Benzene.Core.Middleware/ExceptionHandlerMiddleware.ts`:

```ts
async handleAsync(context: TContext, next: NextFunc): Promise<void> {
  try {
    await next();
  } catch (error) {
    this.logger.logError(error, 'Unhandled exception caught in middleware pipeline');
    this.onException(context, error);
  }
}
```

> **Port note.** The callback's second argument is typed `unknown`, not `Error` — JavaScript lets you
> `throw` any value, so Benzene never assumes what was thrown. Narrow it with `error instanceof Error`
> before reading `.message`/`.stack`. Where the C# original inspects `Exception.InnerException`, the TS
> equivalent is [`Error.cause`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause)
> (per the README [Porting conventions](../../README.md#porting-conventions)).

Two things worth calling out precisely:

1. **It always logs at error level before calling your callback** — `"Unhandled exception caught in
   middleware pipeline"`, with the error attached. This is not optional and does not depend on whether
   your `onException` callback logs anything itself. The logger is resolved via
   `serviceResolver.tryGetService(ILoggerFactory)?.createLogger('Benzene') ?? NullLogger.instance` — so
   if no `ILoggerFactory` is registered, logging silently no-ops through `NullLogger`. `addBenzene(...)`
   wires up logging defaults, so this only bites you if you built the container yourself without them.
2. **It does not rethrow.** Once caught, the error stops propagating up the pipeline unless your
   `onException` callback itself throws — in which case the *original* error is still logged first, and
   then whatever your callback throws propagates to whatever called the pipeline.

This is verified directly by
`test/Benzene.Core.Test/Core/Core/MiddlewareBuilder/MiddlewareTest.test.ts`:

```ts
it('ExceptionHandler_CaughtException_IsLogged', async () => {
  // ...
  builder.useExceptionHandler(() => {});
  builder.useFn(() => {
    throw new Error('Test');
  });
  // ...
  await pipeline.handleAsync({}, resolver);

  const errors = fakeLoggerFactory.collector.entries.filter((x) => x.level === LogLevel.Error);
  expect(errors).toHaveLength(1);
  expect(errors[0].message).toBe('Unhandled exception caught in middleware pipeline');
  expect((errors[0].error as Error).message).toBe('Test');
});

it('ExceptionHandler_ExceptionRethrownByHandler_IsStillLogged', async () => {
  // ...
  builder.useExceptionHandler((_, error) => {
    throw error;
  });
  builder.useFn(() => {
    throw new Error('Test');
  });
  // ...
  await expect(pipeline.handleAsync({}, resolver)).rejects.toThrow('Test');
  // still exactly one Error-level entry logged
});
```

Because the middleware only wraps what comes *after* it, **placement matters**: register
`useExceptionHandler(...)` as early as possible in the pipeline you want protected — before
`useMessageHandlers(...)` and before any other middleware whose errors you want caught. Anything
registered before it is unprotected.

There's an important gap between this and how Benzene normally reports handler failures: when a handler
*returns* `BenzeneResult.unexpectedError(...)` (an unsuccessful [result](../message-result.md), not a
thrown error), the framework's own response pipeline automatically serializes an `ErrorPayload` and maps
the status to an HTTP code. A raw *thrown* error caught by `useExceptionHandler` bypasses that pipeline
entirely — nothing builds a response for you. Your `onException` callback is responsible for constructing
whatever response shape you want.

## Step-by-Step Implementation

### 1. HTTP transport (API Gateway) — map to a 500 response

```ts
import { useApiGateway, ApiGatewayContext, ensureResponseExists } from '@benzene/aws-lambda-api-gateway';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { BenzeneResultStatus, ErrorPayload } from '@benzene/results';
import { CreateOrderHandler } from './CreateOrderHandler.js';

useApiGateway(app, (api) => {
  api.useExceptionHandler((context: ApiGatewayContext) => {
    ensureResponseExists(context);
    const response = context.apiGatewayProxyResponse!;
    response.statusCode = 500; // matches DefaultHttpStatusCodeMapper's unexpected-error -> 500
    response.headers = { ...response.headers, 'content-type': 'application/json' };
    // Build the same body shape the framework serializes for a failed result — with a generic,
    // safe message, never the raw error, so no internal detail leaks to the client.
    response.body = JSON.stringify(
      new ErrorPayload(BenzeneResultStatus.unexpectedError, ['An unexpected error occurred.']),
    );
  });
  useMessageHandlers(api, CreateOrderHandler);
});
```

`500` here isn't an arbitrary choice — it's the same value `DefaultHttpStatusCodeMapper` maps
`BenzeneResultStatus.unexpectedError` to for handlers that fail normally (see
[Message Results — HTTP](../message-result.md#transport-mapping)), so a thrown error and a handler
explicitly returning `BenzeneResult.unexpectedError()` end up looking identical to the client.
`ErrorPayload` (`@benzene/results`) is the same RFC 7807-style payload `DefaultResponsePayloadMapper`
uses for unsuccessful results — it extends `ProblemDetails` and serializes to `{ status, detail }`, where
`detail` is the errors joined with `", "`. You're just building it by hand because the exception path
doesn't run that mapper for you.

`ensureResponseExists(context)` (a free function exported from `@benzene/aws-lambda-api-gateway`)
lazily creates `context.apiGatewayProxyResponse` with safe defaults if no earlier middleware wrote one —
necessary because `APIGatewayProxyResult` requires `statusCode` and `body`, so the context starts it as
`undefined`. The same pattern applies to any other HTTP transport context (`ApiGatewayV2Context`,
`@benzene/express`'s context, `@benzene/azure-function-http`'s `AzureHttpContext`) — set the status code
and write the body on that transport's response object.

### 2. SQS transport — report only the failed message

```ts
import { useSqs, SqsMessageContext } from '@benzene/aws-lambda-sqs';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { ProcessOrderHandler } from './ProcessOrderHandler.js';

useSqs(app, (sqs) => {
  sqs.useExceptionHandler((context: SqsMessageContext) => {
    context.isSuccessful = false;
  });
  useMessageHandlers(sqs, ProcessOrderHandler);
});
```

> **Port note.** The .NET original sets `context.MessageResult = BenzeneResult.UnexpectedError()`. The
> TypeScript `SqsMessageContext` doesn't carry a `messageResult`; instead it exposes the boolean
> `isSuccessful` that `SqsMessageMessageHandlerResultSetter` populates and `SqsApplication` reads. Set
> it to `false` directly — that's the value the batch-failure logic keys off.

This relies on how `SqsApplication.handleAsync` (`src/Benzene.Aws.Lambda.Sqs/SqsApplication.ts`)
processes each record:

```ts
try {
  const scope = serviceResolverFactory.createScope();
  try {
    setCurrentTransport.setTransport(TransportNames.Sqs);
    await this.pipeline.handleAsync(context, scope);
  } finally {
    scope.dispose();
  }

  // An unsuccessful (false) OR unset (undefined) result is reported as a failure.
  if (context.isSuccessful === false) {
    batchItemFailures.push({ itemIdentifier: context.sqsMessage.messageId });
  }
} catch (ex) {
  // logs the exception via ILoggerFactory and pushes the same messageId as a failure anyway
  batchItemFailures.push({ itemIdentifier: context.sqsMessage.messageId });
}
```

Without `useExceptionHandler`, a thrown error is still caught — but one layer up, by `SqsApplication`
itself, which logs its own error and adds the failure. Adding `useExceptionHandler` inside the pipeline
intercepts the error first: `ExceptionHandlerMiddleware` logs `"Unhandled exception caught in middleware
pipeline"`, your callback sets `context.isSuccessful = false`, and the error never reaches
`SqsApplication`'s own `catch` — `SqsApplication` sees a pipeline call that returned normally with an
unsuccessful result and adds the batch item failure through its normal (non-exception) branch.

The net effect for SQS is the same either way (the message ends up in `batchItemFailures` so only it gets
retried/DLQ'd, not the whole batch — see [Handling SQS Message Failures](handling-sqs-failures.md)). What
`useExceptionHandler` buys you is a single, customizable place to decide what "failed" means and to attach
extra logging/telemetry, instead of relying on `SqsApplication`'s hardcoded fallback. The resulting
`SQSBatchResponse` (with a single failing record) serializes to:

```json
{ "batchItemFailures": [ { "itemIdentifier": "some-message-id" } ] }
```

### 3. Wire it into a deployable function

Both pipelines share one startup. Each `useExceptionHandler` is scoped to the pipeline it's registered
on, so each transport gets a callback tailored to its own response shape:

```ts
import { addBenzene, useMessageHandlers } from '@benzene/core-message-handlers';
import { InlineAwsLambdaStartUp, toLambdaHandler } from '@benzene/aws-lambda-core';
import { useApiGateway, ApiGatewayContext, ensureResponseExists } from '@benzene/aws-lambda-api-gateway';
import { useSqs, SqsMessageContext } from '@benzene/aws-lambda-sqs';
import { BenzeneResultStatus, ErrorPayload } from '@benzene/results';
import { CreateOrderHandler } from './CreateOrderHandler.js';
import { ProcessOrderHandler } from './ProcessOrderHandler.js';

const entryPoint = new InlineAwsLambdaStartUp()
  .configureServices((services) => addBenzene(services))
  .configure((app) => {
    useApiGateway(app, (api) => {
      api.useExceptionHandler((context: ApiGatewayContext) => {
        ensureResponseExists(context);
        const response = context.apiGatewayProxyResponse!;
        response.statusCode = 500;
        response.headers = { ...response.headers, 'content-type': 'application/json' };
        response.body = JSON.stringify(
          new ErrorPayload(BenzeneResultStatus.unexpectedError, ['An unexpected error occurred.']),
        );
      });
      useMessageHandlers(api, CreateOrderHandler);
    });

    useSqs(app, (sqs) => {
      sqs.useExceptionHandler((context: SqsMessageContext) => {
        context.isSuccessful = false;
      });
      useMessageHandlers(sqs, ProcessOrderHandler);
    });
  })
  .build();

export const handler = toLambdaHandler(entryPoint);
```

### 4. Logged output

Both callbacks above go through the same `ExceptionHandlerMiddleware`, so both produce the same shape of
log line (same middleware, same fixed message, logger category `"Benzene"`):

```
[Error] Benzene: Unhandled exception caught in middleware pipeline
Error: boom
    at ...
```

The fixed message and the attached error are what your log aggregator keys off; the callback's job is
purely to shape the *response*, not to re-log.

## Testing

Unit-test `onException` wiring the same way the repo does, without needing a real transport — build a
minimal pipeline over a plain object (or your real context type) and assert on both the callback's side
effect and the log entry, following
`test/Benzene.Core.Test/Core/Core/MiddlewareBuilder/MiddlewareTest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import {
  DefaultBenzeneServiceContainer,
  DefaultServiceResolverFactory,
  ServiceCollection,
} from '@benzene/dependencies';

describe('global error handling', () => {
  it('catches a thrown error and runs the callback', async () => {
    const services = new ServiceCollection();
    const container = new DefaultBenzeneServiceContainer(services);
    const builder = new MiddlewarePipelineBuilder<object>(container);

    let caught = false;
    builder.useExceptionHandler(() => {
      caught = true;
    });
    builder.useFn(() => {
      throw new Error('Test');
    });

    const pipeline = builder.build();
    const factory = new DefaultServiceResolverFactory(services);
    const resolver = factory.createScope();
    try {
      await pipeline.handleAsync({}, resolver);
    } finally {
      resolver.dispose();
      factory.dispose();
    }

    expect(caught).toBe(true);
  });
});
```

To assert on the log line, register a fake `ILoggerFactory` (`container.addSingletonInstance(
ILoggerFactory, fakeLoggerFactory)`) and check its collector for a single `LogLevel.Error` entry whose
message is `"Unhandled exception caught in middleware pipeline"` — exactly as the
`ExceptionHandler_CaughtException_IsLogged` test above does. See [Testing Benzene](../testing-benzene.md)
for the full testing guide.

## Troubleshooting

### Errors thrown before `useExceptionHandler` aren't caught

`useExceptionHandler` only wraps middleware registered *after* it on the same builder. Move it to be one
of the first calls in the pipeline — before `useMessageHandlers(...)` and anything else you want
protected.

### The error isn't logged

Confirm an `ILoggerFactory` is actually registered. `addBenzene(...)` wires logging defaults, so this is
rarely an issue with the standard setup — but if you constructed the container yourself without them,
`useExceptionHandler` falls back to `NullLogger.instance` and the log call is a silent no-op. See
[Monitoring & Diagnostics](../monitoring.md).

### HTTP responses come back with the wrong status or no body

The automatic `ErrorPayload`/status-code mapping (`DefaultResponsePayloadMapper`,
`HttpStatusCodeResponseHandler`) only runs for handlers that *return* an unsuccessful `IBenzeneResultOf<T>`
— it never runs for a caught, thrown error. Your `onException` callback has to set the status code and
write the body itself, as in the API Gateway example. If you also called `ensureResponseExists`, make sure
you're mutating the object it created rather than reassigning a fresh one a later handler won't see.

### An SQS message keeps failing the whole batch, not just itself

That symptom is about `SqsBatchFailureMode`, not the exception handler — in the default
`PartialBatchFailure` mode only the failed record is retried. See
[Handling SQS Message Failures](handling-sqs-failures.md). Also confirm your callback sets
`context.isSuccessful = false` (or lets the error propagate to `SqsApplication`'s own catch) rather than
swallowing it and leaving `isSuccessful` at its default `undefined` — note `SqsApplication` treats
`undefined` as a failure too, so it reports the record whenever `isSuccessful !== true`.

### Internal details leaking to the client

Don't put `error instanceof Error ? error.message : String(error)` into the HTTP body — a database driver
or third-party error string can expose schema names, hostnames, or credentials. Log the full error (the
middleware already does), but return a generic message like `'An unexpected error occurred.'` as shown.
The full detail stays in your logs, keyed by the fixed log message.

## Variations

### Different callback per transport

Nothing requires a single shared `onException` — the HTTP and SQS pipelines above each get their own
callback tailored to that transport's response shape. There's no process-wide registration point;
`useExceptionHandler` is added per pipeline (per `useApiGateway(...)`, `useSqs(...)`, etc.), so "global"
here means "consistently applied to every pipeline you configure," not one single handler.

### Combine with `useRetry`

`@benzene/resilience`'s `useRetry(...)` (see [Resilience](../resilience.md)) retries on any thrown error
by default. Register `useExceptionHandler` *first* and `useRetry` *after* it on the same builder, so
retries happen downstream and `useExceptionHandler` only catches the error that survives every retry
attempt.

```ts
useSqs(app, (sqs) => {
  sqs.useExceptionHandler((context: SqsMessageContext) => {
    context.isSuccessful = false;
  });
  useRetry<SqsMessageContext>(sqs);
  useMessageHandlers(sqs, ProcessOrderHandler);
});
```

### Re-throwing after logging

If you want the error to still propagate — e.g. to let a Lambda invocation fail so the platform itself
retries it, rather than converting it to a graceful response — just rethrow in the callback:

```ts
api.useExceptionHandler((_, error) => {
  throw error;
});
```

The error is still logged first (see the `ExceptionHandler_ExceptionRethrownByHandler_IsStillLogged`
test above) — it just isn't swallowed afterward.

## Further Reading

- [Middleware — `useExceptionHandler`](../middleware.md#useexceptionhandler) — pipeline-construction
  reference for this middleware.
- [Common Middleware](../common-middleware.md) — the ready-made middleware Benzene ships.
- [Message Results](../message-result.md) — the `BenzeneResult` factory, statuses, `ErrorPayload`, and
  each transport's mapping.
- [Handling SQS Message Failures](handling-sqs-failures.md) — DLQ, partial-batch-failure, and retry
  patterns for the SQS transport specifically.
- [Resilience](../resilience.md) — pairing `useRetry` with centralized error handling.
- [Monitoring & Diagnostics](../monitoring.md) — how Benzene's `ILogger`/`ILoggerFactory` resolution
  works.
- [Testing Benzene](../testing-benzene.md) — the full testing guide.

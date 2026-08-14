# Structured Logging with Pino

Wire [pino](https://getpino.io/) into a Benzene service and see Benzene's built-in scope enrichment
(correlation id, topic, transport, trace id, …) show up as structured fields on every JSON log line.

## Problem statement

You want pino's fast structured JSON logging instead of plain-text `console.log`, and you want the
request-scoped properties Benzene already attaches — correlation id, topic, transport, trace/span id,
processing time — to appear as first-class fields on every log event, including the log lines your own
handlers write.

**Before you install anything, the important thing to know is what Benzene *doesn't* provide here:**
there is **no `@benzenejs/pino` package**. Benzene logs through its own small `ILogger` / `ILoggerFactory`
abstraction (`@benzenejs/abstractions`, `Logging/ILogger`) — the port's stand-in for .NET's
`Microsoft.Extensions.Logging`, since Node has no platform-standard logging abstraction to plug a
provider into. So the integration is a small **adapter** you write once: a class that implements
`ILogger` over a pino logger, registered as the `ILoggerFactory`. That's the whole surface — there's no
Benzene-side extension point beyond it, and Benzene's enrichment middleware works through it unchanged.

> **Port note (the .NET → TS bend):** the .NET cookbook plugs the standard `Serilog.Extensions.Logging`
> provider into `AddLogging` — no adapter needed, because Benzene .NET logs through the platform
> `ILogger<T>`. TypeScript has no such platform abstraction, so the idiomatic equivalent is a thin
> `ILogger`-over-pino adapter. Everything downstream (the `beginScope` scope model, `useLogResult` /
> `useBenzeneEnrichment`) is identical.

## Prerequisites

- A Benzene service (AWS Lambda, Azure Functions, Express, or a plain worker) using a Benzene container.
- Familiarity with [Monitoring — Logging](../monitoring.md#logging), which documents the `ILogger` /
  scope model this builds on.

## Installation

```bash
npm install pino
```

`@benzenejs/abstractions` (which supplies `ILogger` / `ILoggerFactory`) is already a transitive dependency
of the core packages, so there's nothing else to add on the Benzene side.

## The `ILogger` contract you're implementing

Benzene's logging surface is deliberately minimal (`@benzenejs/abstractions`, `Logging/ILogger`):

```ts
export enum LogLevel { Trace, Debug, Information, Warning, Error, Critical }

export interface ILogger {
  log(logLevel: LogLevel, message: string, error?: unknown): void;
  beginScope(state: Readonly<Record<string, unknown>>): IDisposable;
  logInformation(message: string): void;
  logWarning(message: string): void;
  logError(error: unknown, message: string): void;
  logDebug(message: string): void;
}

export interface ILoggerFactory {
  createLogger(categoryName: string): ILogger;
}
```

`LoggerBase` (also in `@benzenejs/abstractions`) already implements the four level-specific helpers in
terms of `log`, so an adapter only has to implement `log` and `beginScope`.

The one subtlety is **`beginScope`**. Benzene's enrichment middleware opens a scope on *one* logger and
expects the properties to appear on log lines written by *other* loggers from the same factory during
that request — exactly like .NET's ambient logger scopes. So the scope state must be **ambient per
invocation**, not tied to a single logger instance. `AsyncLocalStorage` (from `node:async_hooks`) is
the idiomatic way to hold it, and it keeps concurrent requests from bleeding into one another.

## Step 1 — the pino adapter

```ts
// pinoLogging.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import pino, { type Logger } from 'pino';
import {
  IBenzeneServiceContainer,
  IDisposable,
  ILogger,
  ILoggerFactory,
  LoggerBase,
  LogLevel,
} from '@benzenejs/abstractions';

/** Ambient scope stack, per async invocation, shared by every logger this factory hands out. */
const scopeStorage = new AsyncLocalStorage<Record<string, unknown>[]>();

function activeScope(): Record<string, unknown> {
  return Object.assign({}, ...(scopeStorage.getStore() ?? []));
}

const pinoLevels: Record<LogLevel, 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'> = {
  [LogLevel.Trace]: 'trace',
  [LogLevel.Debug]: 'debug',
  [LogLevel.Information]: 'info',
  [LogLevel.Warning]: 'warn',
  [LogLevel.Error]: 'error',
  [LogLevel.Critical]: 'fatal',
};

class PinoLogger extends LoggerBase {
  constructor(private readonly logger: Logger) {
    super();
  }

  log(logLevel: LogLevel, message: string, error?: unknown): void {
    const bindings = activeScope();
    const merged = error === undefined ? bindings : { ...bindings, err: error };
    this.logger[pinoLevels[logLevel]](merged, message);
  }

  beginScope(state: Readonly<Record<string, unknown>>): IDisposable {
    const stack = scopeStorage.getStore();
    if (stack === undefined) {
      // First scope of this invocation: establish the ambient stack for all descendants.
      const fresh: Record<string, unknown>[] = [{ ...state }];
      scopeStorage.enterWith(fresh);
      return { dispose: () => fresh.pop() };
    }
    stack.push({ ...state });
    return { dispose: () => stack.pop() };
  }
}

export class PinoLoggerFactory implements ILoggerFactory {
  constructor(private readonly root: Logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })) {}

  createLogger(categoryName: string): ILogger {
    return new PinoLogger(this.root.child({ category: categoryName }));
  }
}

/** Registers the pino-backed `ILoggerFactory` so Benzene and your handlers log through pino. */
export function addPinoLogging(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  return services.addSingletonInstance(ILoggerFactory, new PinoLoggerFactory());
}
```

The ambient scope stack merges every active scope into pino's per-line `mergingObject`, so a line logged
deep in a handler carries the `correlationId` / `topic` / `transport` a middleware pushed earlier. This
mirrors the port's own `FakeLoggerFactory` test helper (a shared scope stack), upgraded to
`AsyncLocalStorage` so it's correct under concurrency.

## Step 2 — register it

Register the factory on the container **before** wiring Benzene, so `ILoggerFactory` resolves to pino
everywhere (Benzene's message router and your handlers alike). On the Express host, the container is the
one you hand to `benzene(...)`:

```ts
import express from 'express';
import { useMessageHandlers } from '@benzenejs/core-message-handlers';
import { benzene } from '@benzenejs/express';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { addPinoLogging } from './pinoLogging.js';
import { CreateOrderHandler } from './createOrderHandler.js';

const container = new DefaultBenzeneServiceContainer();
addPinoLogging(container); // <-- pino is now the ILoggerFactory

const app = express();
app.use(benzene((pipeline) => useMessageHandlers(pipeline, CreateOrderHandler), { container }));
```

On AWS Lambda or Azure Functions it's the same call inside `configureServices`:

```ts
export class StartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    addPinoLogging(services); // <-- pino is now the ILoggerFactory
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useAwsLambda(app, (aws) => useSqs(aws, (sqs) => useMessageHandlers(sqs, CreateOrderHandler)));
  }
}

export const handler = new AwsLambdaHost(StartUp).lambdaHandler;
```

With nothing registered, Benzene falls back to a `NullLoggerFactory` and log calls are no-ops — so this
one registration is what turns logging on.

## Step 3 — turn on Benzene's scope enrichment

Add `useLogResult` (or `useLogContext`, if you don't want the extra `"BenzeneResult"` summary line)
early in the pipeline, chaining the fields you want:

```ts
import { CorrelationExtensions } from '@benzenejs/diagnostics';

app.useLogResult((x) => CorrelationExtensions.withCorrelationId(x));
```

- `CorrelationExtensions.withCorrelationId` (`@benzenejs/diagnostics`) — adds `correlationId` (a
  per-invocation UUID unless your own middleware calls `ICorrelationId.set(...)` — see
  [Request Correlation](request-correlation.md)).

Or, for the portable one-call version that also adds `invocationId` / `traceId` / `spanId` / `topic` /
`transport` / `handler` on every platform:

```ts
import { useBenzeneEnrichment } from '@benzenejs/diagnostics';

useBenzeneEnrichment(app);
```

Both attach their properties via `ILogger.beginScope(...)`, which your pino adapter turns into
per-line pino bindings.

## Step 4 — see it in the output

A request produces a `"BenzeneResult"` summary line (from `useLogResult`) plus every other line logged
during that request, all carrying the same scope fields. A handler's own logging inherits them because
it runs inside the same ambient scope:

```ts
import { ILogger, ILoggerFactory } from '@benzenejs/abstractions';

@message('order:create', { requestType: CreateOrderRequest, responseType: CreateOrderResponse })
export class CreateOrderHandler implements IMessageHandler<CreateOrderRequest, CreateOrderResponse> {
  static readonly inject = [ILoggerFactory] as const;
  private readonly logger: ILogger;
  constructor(loggerFactory: ILoggerFactory) {
    this.logger = loggerFactory.createLogger('CreateOrderHandler');
  }

  async handleAsync(request: CreateOrderRequest): Promise<IBenzeneResultOf<CreateOrderResponse>> {
    this.logger.logInformation(`Creating order for ${request.customerId}`);
    // ...
  }
}
```

pino's JSON output for that handler line carries the enriched scope:

```json
{"level":30,"time":1754637242081,"category":"CreateOrderHandler","correlationId":"5c9e2b1a-…","topic":"order:create","transport":"apiGateway","msg":"Creating order for cust-123"}
```

## Testing

There's no pino-specific behavior for Benzene to verify — pino mapping bindings to JSON is pino's
concern. What you verify is that your **adapter** carries the ambient scope, and that
`useLogResult` / `useBenzeneEnrichment` populate it. A capturing factory that records scopes (the shape
the port's own `test/Benzene.Core.Test/Diagnostics/BenzeneEnrichmentTest.test.ts` uses) is the cleanest
way — or point pino at an in-memory stream and assert the parsed JSON:

```ts
import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { PinoLoggerFactory } from './pinoLogging.js';

describe('PinoLoggerFactory', () => {
  it('merges an active beginScope into subsequent log lines', () => {
    const lines: Record<string, unknown>[] = [];
    const stream = { write: (s: string) => lines.push(JSON.parse(s)) };
    const factory = new PinoLoggerFactory(pino({ level: 'info' }, stream));

    const logger = factory.createLogger('test');
    const scope = logger.beginScope({ correlationId: 'abc-123' });
    try {
      // A *different* logger from the same factory still sees the ambient scope.
      factory.createLogger('handler').logInformation('hello');
    } finally {
      scope.dispose();
    }

    expect(lines[0]!.correlationId).toBe('abc-123');
    expect(lines[0]!.category).toBe('handler');
  });
});
```

To verify end to end, run the service locally and confirm `correlationId` / `topic` / `transport`
appear on a real request's JSON lines. See [Testing Benzene](../testing-benzene.md).

## Troubleshooting

- **Scope fields (`correlationId`, `topic`, …) aren't in the output.** They're attached via
  `beginScope`, so confirm your adapter's `beginScope` actually establishes the ambient stack (Step 1)
  and that `log` merges `activeScope()` into every line. If a field is on the `"BenzeneResult"` line but
  not your handler's line, the ambient stack isn't shared across loggers — check you're reading the same
  `AsyncLocalStorage`, not a per-logger copy.
- **Logs aren't reaching pino at all.** Confirm `addPinoLogging(container)` runs and that it's the
  container you actually hand to your host. With no `ILoggerFactory` registered, Benzene uses a
  `NullLoggerFactory` and every log call is a silent no-op.
- **`correlationId` is always a fresh UUID.** `ICorrelationId` self-generates one per invocation; to
  carry a value from an incoming header, call `ICorrelationId.set(...)` from your own middleware — see
  [Request Correlation](request-correlation.md).

## Variations

### winston or another logger

The same adapter shape works for any structured logger: implement `ILogger.log` over the library's
level methods and `beginScope` over the ambient stack. Only the `PinoLogger` internals change; the DI
registration and enrichment wiring are identical.

### Ship to a collector

pino's ecosystem transports (`pino-pretty` for local dev, `pino-opentelemetry-transport` to forward log
records to an OTLP collector) attach to the pino instance you construct in `PinoLoggerFactory` — Benzene
doesn't participate in that choice.

## See also

- [Monitoring & Diagnostics — Logging](../monitoring.md#logging) — the `ILogger` / scope model this builds on.
- [Common Middleware — useLogResult / useLogContext](../common-middleware.md#uselogresult--uselogcontext) —
  the scope-enrichment builder reference.
- [Request Correlation Across Services](request-correlation.md) — populating and forwarding the `correlationId`.
- [Correlation Ids](../correlation-ids.md) — `ICorrelationId` reference.
- [Diagnosing Failures](../diagnosing-failures.md) — reading a failure across logs, traces, and metrics.

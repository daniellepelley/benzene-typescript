# Request Correlation Across Services

Track a single request as it moves through multiple Benzene services.

> **W3C trace context is Benzene's primary cross-service correlation mechanism.** It continues a
> distributed trace from the inbound `traceparent` header on every transport and renders as a connected
> trace tree. If that's what you're after, use it — this page's first section points you at the full
> worked example. The rest of this page covers the smaller, still-useful **header-based correlation
> id** for the one case W3C trace context doesn't cover: honoring a partner's proprietary correlation
> header.

## Problem statement

You're running multiple Benzene services and need to answer "what happened, across every service, for
this one request?" — usually while debugging a production incident, or building a dashboard that groups
logs by request.

## The primary approach: W3C trace context

This is covered in full, worked-example depth in
[Distributed Tracing with OpenTelemetry](distributed-tracing-opentelemetry.md) — exporting to Jaeger/an
OTel Collector, propagating across an Express API and an SQS-backed worker. The short version is two
calls:

```ts
import { useW3CTraceContext } from '@benzene/diagnostics';
// FIRST middleware in the receiving pipeline — parents the root span on the inbound traceparent.
useW3CTraceContext(pipeline);
```

```ts
import { addOutboundRouting } from '@benzene/clients';
import { useW3CTraceContext } from '@benzene/clients'; // outbound counterpart
import { useSqs } from '@benzene/clients-aws-sqs';
// On an outbound route — stamps the active span's traceparent/tracestate onto the message headers.
addOutboundRouting(container, (routing) =>
  routing.route('order:process', (route) => {
    useW3CTraceContext(route);
    useSqs(route, queueUrl, sqs);
  }),
);
```

Rather than one opaque id you grep for, you get a real span per pipeline stage (automatic once you call
`addDiagnostics()`), correlated across services by the shared W3C `traceId` and rendered as a connected
trace once you export it. `useBenzeneEnrichment()` surfaces the same `traceId`/`spanId` in your log
lines (alongside `invocationId`/`topic`/`transport`/`handler`) — see
[Monitoring — Structured log scopes](../monitoring.md#structured-log-scopes).

## When you still need a correlation id: `ICorrelationId`

Some upstream system already sends a proprietary correlation header (`x-partner-request-id`, a legacy
gateway's `correlationId`, …) and expects it echoed or forwarded unchanged. Benzene's `ICorrelationId`
(`@benzene/abstractions`) exists for exactly this: a per-invocation marker you populate from your own
middleware, attach to the log scope, and forward on outbound clients.

`ICorrelationId` self-generates a UUID (via `crypto.randomUUID()`) on construction, so even with nothing
populating it you get a stable per-invocation id in your logs. See [Correlation Ids](../correlation-ids.md)
for the full reference.

### Step 1 — register the service and populate it from the partner header

Register `CorrelationId` as a scoped service with `CorrelationExtensions.addCorrelationId`, then set it
from your own `useFn` middleware. `CorrelationExtensions.getHeader` does the case-insensitive lookup and
returns the first present key in the order you give — falling back to `''` (which `set()` ignores, so
the self-generated id survives a missing header):

```ts
import { IBenzeneServiceContainer, ICorrelationId } from '@benzene/abstractions';
import { BenzeneConfiguration, BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { addBenzene } from '@benzene/core-message-handlers';
import { AwsLambdaHost, useAwsLambda } from '@benzene/aws-lambda-core';
import { CorrelationExtensions } from '@benzene/diagnostics';

export class StartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    addBenzene(services);
    CorrelationExtensions.addCorrelationId(services); // register CorrelationId as scoped
  }

  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useAwsLambda(app, (aws) => {
      aws.useFn('PartnerCorrelation', async (context, next, resolver) => {
        const headers = resolver.getService(IMessageHeadersGetter) as unknown as IMessageHeadersGetter<typeof context>;
        // Try the partner header first, then a standard one; '' when neither is present.
        const id = CorrelationExtensions.getHeader(headers, context, ['x-partner-request-id', 'correlationId']);
        resolver.getService(ICorrelationId).set(id);
        await next();
      });
      // ... the rest of your pipeline (useApiGateway(aws, ...) / useSqs(aws, ...) / ...)
    });
  }
}

export const handler = new AwsLambdaHost(StartUp).lambdaHandler;
```

Because `addCorrelationId` registers the service as **scoped**, each invocation gets its own
`CorrelationId`, so setting it in one request never bleeds into another.

### Step 2 — attach it to the log scope

`CorrelationExtensions.withCorrelationId` adds a `correlationId` field to every log scope created for
the rest of the pipeline. Chain it onto `useLogResult` (which also emits a `"BenzeneResult"` summary
line) or `useLogContext`:

```ts
import { CorrelationExtensions } from '@benzene/diagnostics';

app.useLogResult((x) => CorrelationExtensions.withCorrelationId(x));
```

For a portable, cross-platform enrichment that also covers `invocationId`/`traceId`/`spanId`/`topic`/
`transport`/`handler` in one call, prefer [`useBenzeneEnrichment(app)`](../monitoring.md#structured-log-scopes)
instead of hand-composing `.with*` extensions.

### Step 3 — forward it to downstream calls

An outbound message client can stamp the current invocation's correlation id onto every request it
sends. `withCorrelationId` (from `@benzene/clients`) wraps the client in a decorator that copies
`ICorrelationId.get()` into the outgoing headers before delegating:

```ts
import { withCorrelationId } from '@benzene/clients';

// on your outbound client builder
withCorrelationId(clientBuilder);
```

> **Port divergence — the default header key is `correlationId`, not `x-correlation-id`.** The .NET
> docs mention `x-correlation-id`; this port writes the value under the `correlationId` key. To use a
> specific wire header, pass a custom key as the third constructor argument to
> `CorrelationIdBenzeneMessageClient`. The receiving service's populating middleware (Step 1) must read
> the **same** key the sender writes. See [Correlation Ids — Forwarding](../correlation-ids.md#forwarding-it-to-outbound-calls).

You can run this alongside `useW3CTraceContext` freely — echo the partner's id at the edge, trace
internally via W3C. Just add `useW3CTraceContext` **first**, since it establishes the root span the
automatically-wrapped middleware spans nest under.

## Testing

Drive the partner-correlation middleware directly and assert the id lands where you expect. A capturing
`ILoggerFactory` (shared ambient scope, like the port's own `FakeLoggerFactory`) lets you confirm the
`correlationId` field is attached:

```ts
import { describe, expect, it } from 'vitest';
import { IDisposable, ILogger, ILoggerFactory, LoggerBase, LogLevel } from '@benzene/abstractions';
import { addBenzeneMiddleware, MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { CorrelationExtensions } from '@benzene/diagnostics';

class CapturingLogger extends LoggerBase {
  constructor(private readonly sink: Record<string, unknown>[]) {
    super();
  }
  log(_level: LogLevel, _message: string): void {}
  beginScope(state: Readonly<Record<string, unknown>>): IDisposable {
    this.sink.push({ ...state });
    return { dispose: () => {} };
  }
}
class CapturingLoggerFactory implements ILoggerFactory {
  readonly scopes: Record<string, unknown>[] = [];
  createLogger(): ILogger {
    return new CapturingLogger(this.scopes);
  }
}

describe('correlation id', () => {
  it('attaches a self-generated correlationId to the log scope', async () => {
    const factory = new CapturingLoggerFactory();
    const container = new DefaultBenzeneServiceContainer();
    addBenzeneMiddleware(container);
    container.addSingletonInstance(ILoggerFactory, factory);

    const builder = new MiddlewarePipelineBuilder<object>(container);
    builder.useLogResult((x) => CorrelationExtensions.withCorrelationId(x));
    builder.useFn('handle', (_c, next) => next());

    const resolver = container.createServiceResolverFactory().createScope();
    await builder.build().handleAsync({}, resolver);

    expect(factory.scopes.some((s) => typeof s.correlationId === 'string')).toBe(true);
  });
});
```

For the header-pickup path, send a message carrying `x-partner-request-id` and assert the same value
appears in the scope — and, if forwarded, in the receiving service's logs. See
[Testing Benzene](../testing-benzene.md).

## Troubleshooting

- **`correlationId` doesn't appear in log output.** Confirm `CorrelationExtensions.withCorrelationId`
  is chained onto `useLogResult`/`useLogContext` (or use `useBenzeneEnrichment`), and that your logging
  adapter actually renders scope properties — see
  [Structured Logging with Pino](structured-logging-pino.md).
- **The id differs on each service.** Confirm the outbound route/client has `withCorrelationId` — without
  it nothing forwards the value and each service's `ICorrelationId` self-generates its own UUID. Confirm
  the receiver reads the **same** key the sender writes (`correlationId` by default).
- **A missing partner header wipes the id.** It doesn't — `getHeader` returns `''` when no key matches,
  and `set('')` is ignored, so the self-generated UUID survives. If the id is empty, something is
  calling `set()` with a non-empty but blank-looking value.

## See also

- [Distributed Tracing with OpenTelemetry](distributed-tracing-opentelemetry.md) — the full worked
  example for W3C trace context, the primary correlation mechanism.
- [Correlation Ids](../correlation-ids.md) — reference for `ICorrelationId` / `withCorrelationId` / `getHeader`.
- [Structured Logging with Pino](structured-logging-pino.md) — making the `correlationId` scope field
  show up in a JSON log sink.
- [Clients](../clients.md) — outbound routing and the outbound `withCorrelationId` decorator.
- [Monitoring & Diagnostics](../monitoring.md) — the full tracing/metrics/logging picture.
- [Common Middleware](../common-middleware.md) — `useLogResult` / `useBenzeneEnrichment` reference.

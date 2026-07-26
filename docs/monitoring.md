# Monitoring & Diagnostics

Benzene ships built-in tracing, metrics, and logging so your services are observable and easy to
debug — all emitted through [`@opentelemetry/api`](https://www.npmjs.com/package/@opentelemetry/api),
the standard OpenTelemetry surface for Node.

## Overview

The `@benzene/diagnostics` package layers three kinds of telemetry onto the middleware pipeline:

- **Tracing** — every middleware in every pipeline is automatically wrapped in an OpenTelemetry span,
  tagged with `benzene.*` attributes, once you call `addDiagnostics()`.
- **Metrics** — `useBenzeneMetrics()` records a per-message counter and duration histogram.
- **Logging enrichment** — `useBenzeneEnrichment()` attaches `invocationId`/`traceId`/`spanId`/
  `topic`/`transport`/`handler` to the logging scope for the request.

Benzene never registers an OpenTelemetry SDK or exporter itself — it only *emits* through
`@opentelemetry/api`. Until your app wires up an SDK (`@opentelemetry/sdk-node` plus an exporter),
the API's no-op tracer and meter make every span and instrument cheap and inert. See
[Reaching a real OpenTelemetry backend](#reaching-a-real-opentelemetry-backend) below.

> Most of these surfaces also have short reference entries in
> [Common Middleware](common-middleware.md) — this page is the fuller, task-oriented tour. Where the
> two overlap they cross-link rather than duplicate.

### The automatic span wrapping

The span-per-middleware behaviour is the `IMiddlewareWrapper` mechanism described in
[Middleware → Automatic activity wrapping](middleware.md#automatic-activity-wrapping-imiddlewarewrapper).
`addDiagnostics()` registers `ActivityMiddlewareWrapper`, which decorates every middleware instance —
hand-written, `useFn` inline, the message router, everything — with an `ActivityMiddlewareDecorator`.
You never opt in per middleware.

## Installation

```bash
npm install @benzene/diagnostics
```

`@opentelemetry/api` comes in as a dependency of `@benzene/diagnostics`. To actually export the
telemetry you also install an SDK and exporter (peer to your app, not to Benzene) — for example:

```bash
npm install @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/exporter-metrics-otlp-http
```

## Correlation IDs

Cross-service correlation rides on automatic [W3C trace context](#distributed-tracing) propagation.
A separate, self-generated per-invocation `ICorrelationId` remains available for log-scope
enrichment — see [Correlation Ids](correlation-ids.md) and
`app.useLogResult((x) => CorrelationExtensions.withCorrelationId(x))` in
[Common Middleware](common-middleware.md).

## Tracing

Enable per-middleware spans once, at startup, alongside `addBenzene`:

```ts
import { addBenzene } from '@benzene/core-message-handlers';
import { addDiagnostics } from '@benzene/diagnostics';

addBenzene(services);
addDiagnostics(services);
```

Each middleware now runs inside a span named after its `name`. Nested middleware spans nest under
their parent (the decorator makes its span the active context while the inner middleware runs), so a
single message produces a tree that mirrors the pipeline. The span carries whatever the decorator can
resolve from the current context:

| Attribute | Source |
| --- | --- |
| `benzene.transport` | `ICurrentTransport` (omitted while still unresolved) |
| `benzene.topic` | `IMessageGetter<TContext>.getTopic(context).id` |
| `benzene.version` | the resolved topic's `version` |
| `benzene.handler` | the handler-definition lookup, by topic |
| `benzene.status` | the message result's wire status, on the topic-bearing span (`exception` if it throws) |

When a middleware throws, its span records the exception as a span event and is marked
`SpanStatusCode.ERROR`; the error still propagates.

### Cost when nothing is listening

.NET's `ActivitySource.StartActivity` returns `null` when no listener is attached, so wrapping is
free. OpenTelemetry JS always returns a span object, so the decorator checks `span.isRecording()`
instead: with no SDK registered the span is non-recording, so it ends immediately and the inner
middleware is called directly — no tagging, no context switch. Enabling `addDiagnostics()` therefore
costs effectively nothing until you attach an exporter.

### `addActivityPerMiddleware` vs `addDiagnostics`

`addDiagnostics(services)` brings in three things: the span-per-middleware wrapper, a
`DebugMiddlewareWrapper`, and the span-backed `ActivityProcessTimerFactory` (see
[Named timers](#named-timers)). If you want *only* the per-middleware spans, use the narrower opt-in:

```ts
import { addActivityPerMiddleware } from '@benzene/diagnostics';

addActivityPerMiddleware(services);
```

Both are idempotent and compose safely — calling them in any combination registers the wrapper
exactly once, so a middleware is never double-wrapped.

## Named timers

To measure a specific stretch of pipeline by name, `useTimer(app, name)` opens a span under that
name around the rest of the pipeline:

```ts
import { useTimer } from '@benzene/diagnostics';

useTimer(app, 'my-application');
```

`useTimer(app, name)` resolves the registered `IProcessTimerFactory` and wraps `next()` in a
`create`/`dispose` scope. `addDiagnostics()` registers `ActivityProcessTimerFactory` as the default
factory — that is what makes the named timer open a span. If no `IProcessTimerFactory` is registered
at all (i.e. `addDiagnostics()` was never called), `useTimer(app, name)` silently falls back to
calling `next()` with no timing.

> `IProcessTimer` predates span-based tracing and is kept mainly for source-compatibility with
> existing `useTimer(app, 'name')` call sites. New code that just wants a span can lean on the
> automatic per-middleware wrapping above.

Other `IProcessTimerFactory` implementations ship in the same package if you want different behaviour
instead of (or alongside) spans — register one explicitly to replace the default:

- `LoggingProcessTimerFactory` — logs a `"{timer} started"` line and a
  `"{timer} took {ms}ms to complete"` line (with any tags) through an injected `ILogger`, at `Trace`
  level.
- `DebugTimerFactory` — writes the same start/stop lines to an injectable `DebugSink` (the Node
  stand-in for .NET's `Debug.WriteLine`, silent by default), independent of spans and logging.
- `CompositeProcessTimerFactory` — fans a single timer out to multiple `IProcessTimerFactory`
  instances at once (e.g. spans *and* log lines). It takes the inner factories as a rest parameter:
  `new CompositeProcessTimerFactory(activityFactory, loggingFactory)`.

### Raw elapsed-time callback

For a lower-level hook that measures raw elapsed time without going through `IProcessTimer` at all,
pass a callback instead of a name:

```ts
useTimer(app, (context, elapsedMs) => {
  // e.g. feed elapsedMs into your own metrics system
});
```

This adds a `TimerMiddleware` that wraps `next()` and invokes your callback once the rest of the
pipeline completes — including on exceptions, since it runs in a `finally`. It is unrelated to
spans/tracing and always active regardless of what is registered. The one function dispatches on the
argument type: a `string` selects the named-timer form above, a callback selects this one.

> Elapsed time is the delta between two `Date.now()` readings (whole milliseconds) — the port-wide
> stand-in for .NET's `Stopwatch.ElapsedMilliseconds`.

## Logging

Benzene logs through the `ILogger` / `ILoggerFactory` abstraction in `@benzene/abstractions`, resolved
from the container. There is no Benzene-specific logger to configure: the framework and your handlers
log through whatever `ILoggerFactory` the host registers. With none registered, a null logger makes
log calls no-ops. Handlers take a logger by injecting `ILoggerFactory` (or an `ILogger`) through the
container the same way any other service is resolved.

### Structured log scopes

Middleware can attach structured properties to the logging scope for the duration of a request via
`ILogger.beginScope`. The pipeline members `app.useLogResult(...)` / `app.useLogContext(...)` compose
the individual log-context extensions (correlation id, topic, transport, …) — see
[Common Middleware → useLogResult / useLogContext](common-middleware.md#uselogresult--uselogcontext).

For a single portable call that covers `invocationId`/`traceId`/`spanId`/`topic`/`transport`/`handler`
on every platform — rather than hand-composing those extensions — use `useBenzeneEnrichment`:

```ts
import { useBenzeneEnrichment } from '@benzene/diagnostics';

useBenzeneEnrichment(app);
```

It resolves each field independently and simply omits any whose backing service isn't registered, so
it is safe to add unconditionally on every transport. When a span is active it also reads that span's
`traceId`/`spanId` into the scope and tags the span with `benzene.invocationId`, tying your log lines
to the trace. See also [Common Middleware → useBenzeneEnrichment](common-middleware.md#usebenzeneenrichment).

## Metrics

`useBenzeneMetrics(app)` records two OpenTelemetry instruments, once per pipeline execution, on the
`Benzene` meter:

```ts
import { useBenzeneMetrics } from '@benzene/diagnostics';

useBenzeneMetrics(app);
```

| Instrument | Kind | Meaning |
| --- | --- | --- |
| `benzene.messages.processed` | counter | count of messages processed |
| `benzene.message.duration` | histogram | processing duration in milliseconds |

Both are tagged with the same attributes:

- `topic` — the resolved topic id, or `<missing>` when none is set;
- `transport` — the current transport name, or `<missing>` when unresolved;
- `result` — `success` for any successful result, the result's status string (e.g. `NotFound`) for a
  failure, `exception` when the pipeline throws, or `<missing>` when no result signal was set.

Metrics are at once-per-message granularity — add `useBenzeneMetrics` explicitly around the stage you
want measured (typically the whole pipeline), not per middleware. The duration is timed with
`Date.now()` deltas. When the pipeline throws, the instruments are still recorded (in a `finally`)
before the exception propagates. See also
[Common Middleware → useBenzeneMetrics](common-middleware.md#usebenzenemetrics).

> The `result` tag uses the port's `BenzeneResultStatus` strings (PascalCase — `NotFound`), which
> differ from the .NET doc's kebab-case (`not-found`).

## Distributed Tracing

### W3C trace context (inbound)

`useW3CTraceContext(app)` reads the inbound [W3C `traceparent`](https://www.w3.org/TR/trace-context/)
header (matched case-insensitively), parses it, and starts the pipeline's root span with the remote
trace as its parent — so a distributed trace continues across services instead of each hop starting a
new, disconnected trace. Add it as the **first** middleware in the pipeline:

```ts
import { useW3CTraceContext } from '@benzene/diagnostics';

useW3CTraceContext(app);
```

Every automatically-wrapped middleware span added by `addDiagnostics()` after this point nests under
the remote trace. When the header is missing or fails to parse, it falls back to a normal, parentless
root span — so it is always safe to add. See also
[Common Middleware → useW3CTraceContext](common-middleware.md#usew3ctracecontext).

> Deviation from .NET: `tracestate` is not threaded into the parent context — `@opentelemetry/api`
> exposes no `TraceState` constructor — but the load-bearing continuity (trace id + parent span id)
> is preserved. The parent is marked `isRemote: true` so `ParentBased` samplers treat it as an
> ingested remote trace.

### Propagating to downstream calls (outbound)

To carry the current trace onto an outbound Benzene message, add the outbound counterpart —
`useW3CTraceContext` from `@benzene/clients` — to an outbound route pipeline. It stamps the active
span's `traceparent`/`tracestate` onto the outgoing message headers:

```ts
import { useW3CTraceContext } from '@benzene/clients';

useW3CTraceContext(outboundRoute);
```

A queue/stream consumer on the receiving end picks the parent back up, as long as the inbound
`useW3CTraceContext` (from `@benzene/diagnostics`) is the first middleware in its pipeline. See
[Clients](clients.md) for outbound routing and per-transport header forwarding.

## Reaching a real OpenTelemetry backend

`addDiagnostics()` produces spans and `useBenzeneMetrics()` produces instruments, but neither goes
anywhere until your app registers an OpenTelemetry SDK with an exporter. Unlike .NET — where a
`TracerProviderBuilder` must opt into each source by name (`AddSource("Benzene")`) via a
`Benzene.OpenTelemetry` package — OpenTelemetry JS exports from **every** API tracer and meter once an
SDK is registered globally. There is therefore **no `AddBenzeneInstrumentation()` call and no
Benzene-specific OpenTelemetry package to install**: register the standard SDK and Benzene's telemetry
flows automatically.

```ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  OTLPMetricExporter,
} from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() }),
});

// Start the SDK before your Benzene entry point runs.
sdk.start();
```

Once this is registered, `addDiagnostics()`'s spans become recording (so they get tagged and
exported) and `useBenzeneMetrics()`'s instruments are collected — no other change to your Benzene
setup is needed. Benzene resolves the tracer and meter lazily on each use, so it always binds to
whatever provider is registered at the time.

> `BenzeneDiagnostics` (`@benzene/diagnostics`) exposes the shared `tracer` and `meter` (both named
> `Benzene`) and the `messagesProcessed` / `messageDuration` instruments, should you want to record
> against them directly.

## See also

- [Common Middleware](common-middleware.md) — reference entries for `useTimer`, `useBenzeneMetrics`,
  `useBenzeneEnrichment`, and `useW3CTraceContext`.
- [Middleware](middleware.md) — the `IMiddlewareWrapper` mechanism behind automatic span wrapping.
- [Correlation Ids](correlation-ids.md) — the per-invocation `ICorrelationId` marker for logs.
- [Clients](clients.md) — outbound routing and the outbound `useW3CTraceContext`.
- [Message Results](message-result.md) — the result whose status becomes `benzene.status` / the
  metrics `result` tag.
- [Porting conventions](../README.md#porting-conventions) — how C# `ActivitySource`/`Meter`,
  `Stopwatch`, and extension methods map to the TypeScript shapes shown here.

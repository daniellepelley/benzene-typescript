# Diagnosing Failures

A message failed in production. How do you find out *why*?

This page ties together the signals Benzene emits when something goes wrong in a message handler or in
the middleware pipeline: what you get with nothing configured, the recommended middleware stack that
makes failures easy to trace, and how the same failure surfaces across logs, traces, and metrics. For
*setting up* observability backends see [Monitoring & Diagnostics](monitoring.md); for catching
exceptions and mapping them to responses see
[Global Error Handling](cookbooks/global-error-handling.md).

## Two kinds of failure

Benzene distinguishes two failure modes, and they surface differently:

- **An unsuccessful result** — a handler returns `BenzeneResult.notFound(...)`,
  `BenzeneResult.badRequest(...)`, `BenzeneResult.unexpectedError(...)`, etc. This is a *normal* return
  value: the response pipeline serializes the errors and maps the status to the transport (an HTTP
  404/400/500, an SQS batch-item-failure, …). Nothing threw.
- **A thrown exception** — a handler (or middleware, or a mapper) throws/rejects. This bypasses the
  response pipeline; how it settles depends on the transport (see the
  [catch matrix](#what-reaches-your-logs-per-transport)).

The distinction matters when reading logs: an unsuccessful result and a rejection are *different events*
with different log lines, and a stack trace only exists for the second kind. See
[Message Results](message-result.md) for the status vocabulary.

## What you get with nothing wired

Even with no logging or diagnostics middleware added, the router emits a baseline error signal so
failures aren't completely silent:

| Situation | Signal | Source |
|---|---|---|
| Topic missing from the message | `warning` "Topic is missing" | `MessageRouter` |
| No handler registered for the topic | `warning` "No handler found for topic {topic}" | `MessageRouter` |
| Handler/middleware throws | Transport-dependent — see the [catch matrix](#what-reaches-your-logs-per-transport) | the transport application |

These answer "did my message route, and did it fail?" from a plain log tail — but they carry no
correlation id, no trace id, and no per-message processing time. The recommended stack below adds all of
that.

> These log calls only reach a sink if a logging provider is configured. `addBenzene(...)` makes
> `ILogger` resolvable, but with **no provider** every log call is a no-op — nothing appears regardless
> of what middleware you add. See [Monitoring — Logging](monitoring.md).

## The recommended stack

Add these to each transport pipeline, in this order, before `useMessageHandlers(...)`. The free
functions (`useW3CTraceContext`, `useBenzeneEnrichment`) take the builder first; `useExceptionHandler`
and `useLogResult` are pipeline-builder **members** (see
[Common Middleware](common-middleware.md#uselogresult--uselogcontext)):

```ts
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneConfiguration, BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { useMessageHandlers } from '@benzenejs/core-message-handlers';
import { AwsLambdaHost, useAwsLambda } from '@benzenejs/aws-lambda-core';
import { useSqs, SqsMessageContext } from '@benzenejs/aws-lambda-sqs';
import { addDiagnostics, useW3CTraceContext, useBenzeneEnrichment } from '@benzenejs/diagnostics';

export class StartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    addDiagnostics(services); // span per middleware — marks failing spans Error, tagged benzene.*
  }

  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useAwsLambda(app, (aws) =>
      useSqs(aws, (sqs) => {
        useW3CTraceContext(sqs); // 1. FIRST — continue the caller's distributed trace
        useBenzeneEnrichment(sqs); // 2. attach invocationId/traceId/topic/transport/handler to every log
        sqs
          .useExceptionHandler((context: SqsMessageContext) => {
            context.isSuccessful = false; // 3. catch + log thrown exceptions; settle the message
          })
          .useLogResult(() => {}); // 4. one structured "BenzeneResult" info line per successful message
        useMessageHandlers(sqs, ProcessOrderHandler);
      }),
    );
  }
}

export const handler = new AwsLambdaHost(StartUp).lambdaHandler;
```

What each layer contributes when something fails:

| Layer | On failure it gives you |
|---|---|
| `addDiagnostics(services)` | The failing **span** is marked `SpanStatusCode.ERROR` with an exception event, tagged `benzene.transport`/`benzene.topic`/`benzene.handler`/`benzene.status`. A no-op until an OpenTelemetry SDK is registered — cheap otherwise (the span is non-recording). |
| `useW3CTraceContext(app)` | The trace **continues from the caller** instead of starting fresh, so the failure is on the same trace as whatever triggered it. Must be first; safe when the header is absent. |
| `useBenzeneEnrichment(app)` | `invocationId`, `traceId`, `spanId`, `topic`, `transport`, `handler` on **every** log line in the pipeline (each omitted gracefully when unavailable). Portable across all transports. |
| `app.useExceptionHandler(...)` | An `error` log plus your callback decides how the transport settles. The callback is transport-specific — see [Global Error Handling](cookbooks/global-error-handling.md). |
| `app.useLogResult(...)` | One `info` "BenzeneResult" line with `processTime` per **successful** message (it does not log on a throw; a handler-body throw is logged by `MessageHandler` as `error`). |

Add [`useBenzeneMetrics(app)`](common-middleware.md#usebenzenemetrics) too if you want the failure to
also move a counter/histogram — see [below](#in-metrics).

## How a failure shows up across the three signals

### In logs

An *unsuccessful result* (no throw) produces the router `warning`; a thrown error produces an `error`
with a stack. Both carry the enrichment fields, so `traceId` ties every line of one message together
(and across services), `topic` + `status` narrows to a failure kind, and `transport` separates which
adapter handled it.

### In traces

With `addDiagnostics()` and an OpenTelemetry SDK registered
([Monitoring — reaching a real backend](monitoring.md)), the failing middleware's span carries
`SpanStatusCode.ERROR` and an `exception` event with the stack, so a trace viewer (Jaeger, Tempo,
Application Insights) points straight at the stage that threw. Every span is tagged with topic/handler,
and `useW3CTraceContext()` keeps it on the caller's trace.

> Unlike .NET's `ActivitySource.StartActivity` (which returns `null` when no listener is attached), the
> OpenTelemetry JS API always returns a span object. Benzene's wrapper checks `span.isRecording()`
> instead, so with no SDK registered the span ends immediately and the inner middleware is called
> directly — near-zero cost. See [Monitoring](monitoring.md).

### In metrics

With [`useBenzeneMetrics(app)`](common-middleware.md#usebenzenemetrics), every message moves two
instruments tagged `topic`/`transport`/`result`:

- `benzene.messages.processed` (counter) — the `result` tag lets you alert on a rising rate of a
  specific failure status for a topic.
- `benzene.message.duration` (histogram, ms) — a failure that's actually a timeout shows up here as a
  latency spike, not just an error count.

## Ordering footguns

A few middleware silently do nothing if wired in the wrong order — no error, just missing data:

- **`useW3CTraceContext(app)` must be the *first* middleware.** Everything after it inherits the correct
  active-span parent; put it later and the earlier spans start a new, disconnected trace and inbound
  `traceparent` continuation is lost.
- **Enrichment's `invocationId` needs an invocation upstream.** On the batch/per-message transports (SQS,
  SNS, Kafka, Event Hub) `useBenzeneInvocation` (`@benzenejs/aws-lambda-core`) is wired per record
  automatically; on a hand-built pipeline, populate the invocation before `useBenzeneEnrichment(app)`
  runs, or that one field is omitted.
- **`useExceptionHandler(...)` only wraps what comes *after* it.** Register it before
  `useMessageHandlers(...)`. Anything earlier in the chain is unprotected.
- **`useLogResult(...)` should sit outside the handlers** so its `processTime` covers the whole pipeline
  and it logs the result the handlers produced.

## What reaches your logs per transport

When a handler throws, what Benzene logs (before any middleware you add) depends on the transport
application that owns the invocation:

| Transport | Exception handling | Benzene-logged with context? |
|---|---|---|
| AWS Lambda SQS | catch per record → batch-item-failure | **Yes** — `error` per failed record |
| AWS Lambda SNS / DynamoDb / Kinesis | catch per record | **Yes** — `error` per record |
| AWS Lambda S3 / EventBridge / Kafka | propagates to the Lambda host | Only the runtime's raw error (no Benzene context) — wire `useExceptionHandler`/`useLogResult` to get a context log line |
| Azure Functions triggers | escalation to the Functions host | Host logs; Benzene adds structured logs where the app catches |
| HTTP (API Gateway / Express) | maps to a status code | Exception → the app's error path / `useExceptionHandler` if wired |

Two takeaways: the **AWS batch family already attributes a throw to a specific record**; the
**single-event AWS Lambda sources (S3/EventBridge/Kafka) lean on the platform host**, so wiring
`useExceptionHandler`/`useLogResult` there is what gets you a Benzene-context log line instead of a bare
stack trace in CloudWatch.

## Checklist

1. **Was it an unsuccessful result or a throw?** Look for the router `warning` (result) vs. an `error`
   with a stack (throw).
2. **Grep by `traceId`** (or `invocationId`) to pull every line of that one message together.
3. **Check the `topic`/`handler` tags** — a "No handler found for topic" warning means a
   routing/registration problem, not a handler bug.
4. **Open the trace** if you export spans — the `ERROR`-status span names the failing stage.
5. **Nothing in the logs at all?** Confirm a logging **provider** is configured (not just resolvable
   loggers), and that `useLogResult`/`useExceptionHandler` sit before `useMessageHandlers(...)`.

## See Also

- [Monitoring & Diagnostics](monitoring.md) — configuring logging, tracing, W3C context, and OpenTelemetry export.
- [Sampling Strategies](sampling-strategies.md) — controlling how much trace data the OTel SDK records.
- [Global Error Handling](cookbooks/global-error-handling.md) — `useExceptionHandler` and per-transport response mapping.
- [Common Middleware](common-middleware.md) — reference for `useBenzeneEnrichment`, `useLogResult`, `useBenzeneMetrics`.
- [Correlation Ids](correlation-ids.md) — tracking a request across services.
- [Message Results](message-result.md) — the result statuses these signals report.

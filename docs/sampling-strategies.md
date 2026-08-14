# Sampling Strategies

Controlling how much of your tracing Benzene keeps — configured entirely on your app's OpenTelemetry SDK, not on Benzene.

## Overview

Tracing every request in production is usually too expensive: 100% of spans exported at real traffic
volumes costs money at your tracing backend and adds a small but nonzero per-request overhead for every
exporter call. *Sampling* is how you keep a representative fraction of traces instead of all of them.

Benzene does **not** implement its own sampling logic. It emits spans through
[`@opentelemetry/api`](https://www.npmjs.com/package/@opentelemetry/api) once you call `addDiagnostics()`
(`@benzenejs/diagnostics`) — every middleware in every pipeline is wrapped in a span, tagged with
`benzene.*` attributes. Whether any given span is *recorded and exported* is decided by the `Sampler`
configured on the OpenTelemetry SDK your app registers. There is no `@benzene` sampling API to learn:
the sampler is a standard OpenTelemetry construct, applied to Benzene's spans exactly as it would be to
spans from any other instrumented library. This page is a guide to that standard configuration in a
Benzene context — see [Monitoring & Diagnostics](monitoring.md) for the wider tracing/metrics/logging
picture and for wiring a real backend.

Because Benzene binds lazily to whatever provider is registered globally, the sampler decision is made
by the SDK at the moment each span starts. With **no** SDK registered at all, the API's tracer is a
no-op: Benzene's spans are non-recording, the decorator ends them immediately, and the inner middleware
runs directly — so sampling only becomes relevant once you actually attach an SDK and exporter.

## Prerequisites / Installation

Node 22+, plus the OpenTelemetry SDK, a sampler source, and an exporter. These are **OpenTelemetry**
packages (peers of your app), not `@benzenejs/*` packages:

```bash
npm install @opentelemetry/sdk-node @opentelemetry/sdk-trace-base @opentelemetry/exporter-trace-otlp-http
```

`@benzenejs/diagnostics` (which you already have from `addDiagnostics()`) brings `@opentelemetry/api` in
transitively. The `Sampler` implementations live in `@opentelemetry/sdk-trace-base` (also re-exported by
`@opentelemetry/sdk-trace-node`); the `NodeSDK` that accepts the `sampler` option comes from
`@opentelemetry/sdk-node`. Nothing else is needed on the Benzene side — there is no
Benzene-specific OpenTelemetry package to install.

## Basic Usage

Configure a sampler on the SDK, start it before your Benzene entry point runs, and Benzene's middleware
spans flow through it automatically:

```ts
// bootstrap.ts — OpenTelemetry SDK setup (not @benzene)
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  sampler: new TraceIdRatioBasedSampler(0.1), // keep ~10% of traces
});

// Start the SDK before the first Benzene message is processed,
// so its TracerProvider is registered by the time the first span is created.
sdk.start();
```

From here on, every span `addDiagnostics()` produces is offered to that sampler. A trace is sampled or
dropped as a whole (see `TraceIdRatioBasedSampler` below), so you never end up with a partial trace
where some of Benzene's per-middleware spans are missing and others survive.

## Choosing a strategy

### Development / debugging: always-on

Records every span. Ideal locally and in the diagnostics example project, where you want to see the full
per-middleware span tree for every request. Not recommended for production — it exports 100% of trace
data.

```ts
import { AlwaysOnSampler } from '@opentelemetry/sdk-trace-base';
// sampler: new AlwaysOnSampler()
```

The OpenTelemetry JS SDK's default sampler is already `ParentBasedSampler` wrapping `AlwaysOnSampler`,
so a bare SDK effectively records everything — fine for development, but set the production sampler
explicitly rather than relying on the default.

### Production: `TraceIdRatioBasedSampler`

Samples a fixed fraction of traces, decided deterministically from the trace ID. Because the decision is
a pure function of the trace ID, a trace is either fully kept or fully dropped end-to-end — you never get
gaps mid-trace.

```ts
import { TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
// sampler: new TraceIdRatioBasedSampler(0.1) // ~10%
```

Start conservative (1–10%) for high-traffic services and raise the ratio if trace volume and cost allow.
There is no Benzene-specific guidance on the right ratio — it depends on your traffic and what your
backend charges to ingest spans.

### Respecting upstream decisions: `ParentBasedSampler`

If an inbound request already carries a `traceparent` header with a sampling decision, you usually want
to honor it rather than re-sample independently, so a distributed trace stays complete across services
instead of having gaps where one service's sampler disagreed with an upstream one. Benzene's inbound
`useW3CTraceContext(app)` (`@benzenejs/diagnostics`) parses `traceparent`, marks the parent
`isRemote: true`, and starts the pipeline's root span under it — which is exactly what a `ParentBased`
sampler keys off:

```ts
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
// sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(0.1) })
```

`root` is the sampler used only when there is no parent (this service is the first hop); when a sampled
parent is present the trace is kept, and when an unsampled parent is present it is dropped. This is
usually the right choice for any service that isn't the first hop — most services sitting behind a
gateway or another Benzene service. Add `useW3CTraceContext(app)` as the **first** middleware in the
pipeline so the remote parent is established before any span-based decision is made.

### Turning tracing off: always-off

Disables tracing while leaving the rest of the OpenTelemetry pipeline — metrics in particular — wired up
unchanged. Useful to kill tracing quickly during an incident (for example when the exporter itself is the
problem) without touching metrics.

```ts
import { AlwaysOffSampler } from '@opentelemetry/sdk-trace-base';
// sampler: new AlwaysOffSampler()
```

### Switching by environment variable

The OpenTelemetry JS SDK also reads `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG`, so you can change
the sampler per environment with no code change:

```bash
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
```

## Keeping the traces that matter: error-aware sampling

The catch with head-based ratio sampling is that it is blind to the outcome: it decides at the *start* of
a trace, before the handler has run, so a 1% sampler drops 99% of your failures too — exactly the traces
you most want to keep. There are two standard ways to keep error traces under a low overall rate. Neither
is Benzene-specific.

### Tail sampling in the OpenTelemetry Collector

The most common approach is to sample *always-on* in the app and let the
[OpenTelemetry Collector](https://opentelemetry.io/docs/collector/) decide what to keep after it has seen
all of a trace's spans, using its `tail_sampling` processor. Because Benzene marks a failing span with
`SpanStatusCode.ERROR` and a `benzene.status` attribute (see
[Monitoring — Tracing](monitoring.md#tracing)), the Collector can key policies off exactly those:

```yaml
# otel-collector-config.yaml — keep all errors, sample the rest at 10%
processors:
  tail_sampling:
    decision_wait: 10s
    policies:
      - name: keep-errors
        type: status_code
        status_code: { status_codes: [ERROR] }
      - name: keep-slow
        type: latency
        latency: { threshold_ms: 1000 }
      - name: sample-the-rest
        type: probabilistic
        probabilistic: { sampling_percentage: 10 }
```

With the app on `AlwaysOnSampler` and the Collector making the real decision, every failed or slow
Benzene request is retained while healthy traffic is thinned out. The trade-off is that the Collector
must buffer complete traces (memory and a `decision_wait` delay), and the app exports 100% of spans to
the Collector even though most are dropped — this is a backend/collector concern, not something Benzene
or its diagnostics integration participates in directly.

### A custom head sampler

If you can't run a Collector, you can implement your own `Sampler` (a standard OpenTelemetry interface —
implement `shouldSample`) that inspects the span name or attributes and returns a different decision per
case. Benzene applies one sampler uniformly to every span it creates, across every transport and topic,
so per-topic rates are done here rather than through any Benzene setting: read the `benzene.topic`
attribute (or the span name) in `shouldSample` and vary the result. The limitation is fundamental to
head sampling — at span start the handler hasn't run, so you can raise the rate for a suspect topic but
you can't yet know that *this* request will fail. For outcome-based decisions, prefer tail sampling.

## You can still find a sampled-out request

Sampling only applies to the **tracing** pipeline. Two Benzene signals remain, so a dropped trace does
not mean a lost request:

- **Metrics are never sampled.** `useBenzeneMetrics(app)` records `benzene.messages.processed` and
  `benzene.message.duration` unconditionally, once per message, tagged with `topic` / `transport` /
  `result`. Turning trace sampling down to cut cost loses no metrics data — a rising failure rate or a
  latency spike still shows up on the histogram even if not one of those traces was kept. See
  [Monitoring — Metrics](monitoring.md#metrics).
- **Logs are unsampled and carry the identifiers.** `useBenzeneEnrichment(app)` stamps `invocationId`,
  `traceId`, `spanId`, `topic`, `transport`, and `handler` onto every log line, and Benzene's spans
  carry the same values as `benzene.*` attributes. So even when a trace was sampled out, you can grep
  your logs by the self-generated [correlation id](correlation-ids.md) or by `traceId` and pull together
  every line of that one invocation across services — the log for a dropped trace is exactly as complete
  as the log for a kept one.

The practical upshot: sample traces aggressively for cost, and lean on metrics and the correlation
id / `benzene.*` tags to still investigate the specific requests you didn't keep a trace for. See
[Diagnosing Failures](diagnosing-failures.md) for reading a failure across all three signals, and
[Message Results](message-result.md) for the status vocabulary behind `benzene.status` and the metrics
`result` tag.

## Troubleshooting

- **No spans appear at all.** Confirm you called `addDiagnostics(services)` *and* started an
  OpenTelemetry SDK before the first message. With no SDK the API's tracer is a no-op and Benzene's spans
  are non-recording by design — this is not the sampler. See [Monitoring](monitoring.md).
- **Failures never show in traces under low sampling.** Head-based ratio sampling decides before the
  handler runs, so it drops failures at the same rate as successes. Move to Collector tail sampling with a
  `status_code: ERROR` policy, or a custom sampler, as above.
- **A trace is missing spans from one service.** That service's internal sampler disagreed with the
  upstream decision. Switch it to `ParentBasedSampler` and make `useW3CTraceContext(app)` its first
  middleware so it honors the inbound `traceparent`.

## See Also

- [Monitoring & Diagnostics](monitoring.md) — the broader tracing/metrics/logging picture and wiring a
  real OpenTelemetry backend.
- [Diagnosing Failures](diagnosing-failures.md) — reading a failing message across logs, traces, and
  metrics, including sampled-out requests.
- [Correlation Ids](correlation-ids.md) — the per-invocation marker that finds a request when its trace
  was dropped.
- [Message Results](message-result.md) — the result status behind `benzene.status` and the metrics
  `result` tag.
- [Porting conventions](../README.md#porting-conventions) — how the C# `ActivitySource`/`Sampler`
  concepts map to the OpenTelemetry JS shapes shown here.

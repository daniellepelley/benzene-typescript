# `@benzene-example/opentelemetry`

A BenzeneMessage service instrumented with [`@benzene/diagnostics`](../../src/Benzene.Diagnostics): every
pipeline middleware becomes a **span** on Benzene's `"Benzene"` tracer, and the handlers add their own
business child spans — all exported through whatever OpenTelemetry SDK you register. Ported from the .NET
`Benzene.Examples.OpenTelemetry`.

## What this shows

- `addDiagnostics(container)` wraps every middleware in an OpenTelemetry span (tagged with the transport,
  topic, handler, and Benzene status by `useBenzeneEnrichment`).
- The pipeline layers `useW3CTraceContext` (continue an inbound `traceparent` instead of starting a
  disconnected trace), `useBenzeneEnrichment`, and `useBenzeneMetrics` (the `benzene.messages.processed`
  counter + `benzene.message.duration` histogram).
- The handlers open **child spans** on the example's own tracer under the active pipeline span:

| Topic | Trace shape |
|---|---|
| `greeting` | trivial request/response — just the span-per-middleware |
| `order_create` | a `Payment.Charge` span, then `Warehouse.ReserveStock` + `Warehouse.Dispatch` from the injected `IWarehouseService` |
| `order_fail` | throws inside the handler — the framework catches it and returns a non-success status; its `Payment.Charge` span is marked an **error** span |

## No `AddBenzeneInstrumentation` step

.NET's `Benzene.OpenTelemetry.AddBenzeneInstrumentation()` opts the `"Benzene"` `ActivitySource`/`Meter`
into a `TracerProviderBuilder` by name. OpenTelemetry **JS** exports spans/instruments from every API
tracer/meter once an SDK is registered, so there is no per-source registration step and no
`Benzene.OpenTelemetry` counterpart package — wiring an exporter is done entirely in the OTel SDK, not in
Benzene. Point an `@opentelemetry/sdk-node` `NodeSDK` (with an OTLP exporter) at your collector and the
spans this example produces flow straight through.

## Verify it

`test/Benzene.Core.Test/Examples/OpenTelemetryExampleTest.test.ts` boots the real app and sends each topic
through the front door with an **in-memory OpenTelemetry span exporter** (the same `OtelHarness` the port's
own diagnostics tests use — no collector needed). It asserts both the dispatch outcome (ok / created /
caught-failure) **and** the emitted spans: the span-per-middleware, the nested `Payment.Charge` /
`Warehouse.*` business spans sharing the root trace id, and the error span for the failing handler.

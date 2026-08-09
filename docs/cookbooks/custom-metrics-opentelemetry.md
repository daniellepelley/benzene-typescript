# Custom Metrics with OpenTelemetry

Emit Benzene's built-in message metrics — and your own business metrics — through OpenTelemetry to
Prometheus, an OTLP collector, or any metrics backend.

## Problem statement

You want to:

- Track how many messages each topic processes and how long they take, without hand-instrumenting
  handlers.
- Export those metrics to your monitoring backend.
- Add your own domain metrics (orders placed, payments failed) alongside them.

> **The big difference from .NET:** there is **no `@benzene/opentelemetry` package and no
> `AddBenzeneInstrumentation()` / `AddMeter("…")` call.** In .NET a `MeterProviderBuilder` must opt
> into each meter by name. OpenTelemetry JS collects instruments from **every** API meter once a
> `MeterProvider` is registered globally — Benzene's `"Benzene"` meter *and* your own — so there's no
> per-meter registration step. See [Monitoring — Metrics](../monitoring.md#metrics).

## Prerequisites

- A Benzene service (any transport) with `addDiagnostics()` registered.
- A metrics backend (Prometheus, an OTLP collector, …).
- [Node.js 22+](https://nodejs.org/).

## Installation

`@benzene/diagnostics` brings `@opentelemetry/api` in transitively — enough to *record* instruments. To
*export* them, add the Node SDK, the metrics SDK, and an exporter (OpenTelemetry packages, peers of
your app):

```bash
npm install @benzene/diagnostics
npm install @opentelemetry/sdk-node @opentelemetry/sdk-metrics @opentelemetry/exporter-metrics-otlp-http
```

## Benzene's built-in metrics

`useBenzeneMetrics(app)` records two instruments on the `"Benzene"` meter, **once per pipeline
execution**:

| Instrument | Kind | Meaning |
| --- | --- | --- |
| `benzene.messages.processed` | counter | count of messages processed |
| `benzene.message.duration` | histogram (ms) | processing duration |

Both are tagged with `topic` (the resolved topic id, or `<missing>`), `transport` (the current
transport name, or `<missing>`), and `result` — `success` for any successful result, the result's
status string (e.g. `NotFound`) for a failure, `exception` when the pipeline throws, or `<missing>`
when no result signal was set.

> The `result` tag uses the port's `BenzeneResultStatus` strings (PascalCase — `NotFound`), which
> differ from the .NET doc's kebab-case (`not-found`).

## Step 1 — measure the pipeline

Register diagnostics at startup, then add `useBenzeneMetrics` around the stage you want measured
(typically the whole pipeline — it's once-per-message, not per middleware):

```ts
import { addBenzene, addBenzeneMessage, useMessageHandlers } from '@benzene/core-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { BenzeneMessageContext } from '@benzene/core-messages';
import { addDiagnostics, useBenzeneMetrics } from '@benzene/diagnostics';
import { PlaceOrderHandler } from './placeOrderHandler.js';

addBenzene(container);
addBenzeneMessage(container);
addDiagnostics(container);

const pipeline = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
useBenzeneMetrics(pipeline); // records processed count + duration for what follows
useMessageHandlers(pipeline, PlaceOrderHandler);
```

`useBenzeneMetrics` records unconditionally — OpenTelemetry JS's no-op meter already makes `add`/
`record` cheap when no SDK is registered, so there's no `Enabled` gate to worry about. Metrics are
**never sampled** (unlike traces), so they remain complete even when you sample traces aggressively —
see [Sampling — you can still find a sampled-out request](../sampling-strategies.md#you-can-still-find-a-sampled-out-request).

## Step 2 — add your own business metrics

Benzene's instruments are standard `@opentelemetry/api` instruments, so add your own on a `Meter` of
your choosing and record from inside a handler. No registration is needed beyond getting the meter:

```ts
import { Attributes, Counter, metrics } from '@opentelemetry/api';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';
import { BenzeneResult } from '@benzene/results';

/** Your own domain meter and instruments. */
const OrderMetrics = {
  meter: metrics.getMeter('myapp.orders'),
  get ordersPlaced(): Counter {
    return this.meter.createCounter('orders.placed', {
      description: 'Orders accepted for processing',
    });
  },
};

export class PlaceOrder {
  channel = 'web';
}
export class OrderReceipt {
  orderId = '';
}

@message('order:place', { requestType: PlaceOrder, responseType: OrderReceipt })
export class PlaceOrderHandler implements IMessageHandler<PlaceOrder, OrderReceipt> {
  handleAsync(request: PlaceOrder): Promise<IBenzeneResultOf<OrderReceipt>> {
    const attributes: Attributes = { channel: request.channel };
    OrderMetrics.ordersPlaced.add(1, attributes);

    const receipt = new OrderReceipt();
    receipt.orderId = `order-${Math.random().toString(16).slice(2, 10)}`;
    return Promise.resolve(BenzeneResult.created(receipt));
  }
}
```

Fetching the meter through `metrics.getMeter(...)` lazily binds to whatever `MeterProvider` is
registered when the instrument is first used — so, exactly like Benzene's own instruments, your
counter starts collecting the moment you register an SDK in Step 3, with no wiring between the two.

> If you'd rather record against Benzene's own instruments directly, `BenzeneDiagnostics` (from
> `@benzene/diagnostics`) exposes `meter`, `messagesProcessed`, and `messageDuration` — e.g.
> `BenzeneDiagnostics.meter.createHistogram('myapp.order.value').record(9.99, { currency: 'GBP' })`.

## Step 3 — export via OpenTelemetry

Register a `MeterProvider` with a reader/exporter **before** your Benzene entry point runs. Because
OpenTelemetry JS collects from every meter, this single registration exports *both* Benzene's
`benzene.*` instruments and your `orders.placed` counter — there is no `.AddMeter("myapp.orders")` step
to remember:

```ts
// metrics.ts — imported at the very top of your entry module.
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

const sdk = new NodeSDK({
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: 'http://localhost:4318/v1/metrics' }),
    exportIntervalMillis: 15_000,
  }),
});

sdk.start();
```

## Testing

Attach an in-memory metric reader to a `MeterProvider`, register it globally, send a message through
the pipeline, and assert the expected instruments and tag values. Because Benzene binds the meter
lazily, its instruments land in your reader with no other change:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { metrics } from '@opentelemetry/api';
import { DataPoint, MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';

/** A reader that only collects on demand — no push interval. */
class CollectingMetricReader extends MetricReader {
  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }
}

const reader = new CollectingMetricReader();

beforeEach(() => {
  metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
});
afterEach(() => metrics.disable());

async function points(instrument: string): Promise<DataPoint<number>[]> {
  const result = await reader.collect();
  const out: DataPoint<number>[] = [];
  for (const scope of result.resourceMetrics.scopeMetrics) {
    for (const metric of scope.metrics) {
      if (metric.descriptor.name === instrument) {
        out.push(...(metric.dataPoints as DataPoint<number>[]));
      }
    }
  }
  return out;
}

describe('order metrics', () => {
  it('records the Benzene counter and the custom orders.placed counter', async () => {
    const { app, factory } = buildApp(); // your Step 1–2 wiring
    await app.handleAsync(
      Object.assign(new BenzeneMessageRequest(), {
        topic: 'order:place',
        body: JSON.stringify({ channel: 'web' }),
        headers: {},
      }),
      factory,
    );

    const processed = await points('benzene.messages.processed');
    expect(processed).toHaveLength(1);
    expect(processed[0]!.attributes.result).toBe('success');
    expect(processed[0]!.attributes.topic).toBe('order:place');

    const placed = await points('orders.placed');
    expect(placed[0]!.attributes.channel).toBe('web');
  });
});
```

This is the same in-memory-reader pattern the port's own
`test/Benzene.Core.Test/Diagnostics/BenzeneMetricsTest.test.ts` uses — the best reference for the exact
tag values on `benzene.*`. See [Testing Benzene](../testing-benzene.md).

## Troubleshooting

- **`benzene.*` metrics are missing.** `useBenzeneMetrics(app)` must be in the pipeline (it's not
  automatic), and a `MeterProvider` must be registered before the first message. With no provider the
  API meter is a no-op — records are silently dropped.
- **Custom metrics missing but Benzene's present (or vice versa).** In OpenTelemetry JS this can't
  happen through meter registration — one global `MeterProvider` collects from *all* meters. If one is
  missing, check that instrument is actually being recorded (the `add`/`record` call runs) and that
  your reader's `views`/filters aren't dropping it.
- **Durations look like whole numbers only.** `benzene.message.duration` is timed with `Date.now()`
  deltas (millisecond resolution) — the port-wide stand-in for .NET's `Stopwatch.ElapsedMilliseconds`.

## Variations

### Prometheus

Swap the OTLP reader for `@opentelemetry/exporter-prometheus`'s `PrometheusExporter` to expose a
`/metrics` scrape endpoint instead of pushing OTLP.

### Tracing too

Pair this with [Distributed Tracing with OpenTelemetry](distributed-tracing-opentelemetry.md) — add a
`traceExporter` to the same `NodeSDK` and Benzene's spans flow through it automatically, no extra
Benzene wiring.

## See also

- [Monitoring & Diagnostics — Metrics](../monitoring.md#metrics) — the built-in instruments in context.
- [Common Middleware — useBenzeneMetrics](../common-middleware.md#usebenzenemetrics) — the reference entry.
- [Distributed Tracing with OpenTelemetry](distributed-tracing-opentelemetry.md) — the tracing counterpart.
- [Sampling Strategies](../sampling-strategies.md) — why metrics stay complete when traces are sampled.
- [Message Results](../message-result.md) — the status vocabulary behind the `result` tag.

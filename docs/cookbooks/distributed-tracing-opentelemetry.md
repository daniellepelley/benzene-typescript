# Distributed Tracing with OpenTelemetry

Set up end-to-end distributed tracing across two Benzene services with OpenTelemetry, so a single
request shows up as one connected trace instead of a pile of disconnected spans.

## Problem statement

You're running more than one Benzene service — say, an Express HTTP API that queues work onto an SQS
queue, and a worker that consumes it — and you need to:

- See a single request as **one trace**, spanning both services, in a real backend (Jaeger, an OTel
  Collector, Tempo, …).
- Get this largely for free from Benzene's built-in span instrumentation, rather than hand-rolling
  spans in every handler.
- Understand exactly where trace continuity works: the inbound `traceparent` extraction and outbound
  propagation are the two seams you wire up, and Benzene wraps everything in between automatically.

This cookbook builds it up in two passes: first a **single, fully in-memory service** you can run and
test with no external backend (the shape the port's own `examples/opentelemetry` project uses), then
the **cross-service** wiring — propagating the trace onto an SQS message and
picking it back up in the worker — plus the OTLP exporter for production.

> **The big difference from .NET:** there is **no `@benzene/opentelemetry` package and no
> `AddBenzeneInstrumentation()` call.** In .NET a `TracerProviderBuilder` must opt into each source by
> name (`AddSource("Benzene")`). OpenTelemetry JS exports spans from **every** API tracer once an SDK
> is registered globally, so you register the standard `@opentelemetry/sdk-node` and Benzene's spans
> flow automatically. See [Monitoring — Reaching a real backend](../monitoring.md#reaching-a-real-opentelemetry-backend).

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and a Benzene service.
- Familiarity with [Monitoring & Diagnostics](../monitoring.md) (the tracing/metrics/logging surface
  this builds on) and [Clients](../clients.md) (outbound routing).
- For the cross-service part: an SQS queue (a local one via
  [LocalStack](https://github.com/localstack/localstack) is fine) and Docker to run Jaeger.

## Installation

`@benzene/diagnostics` brings `@opentelemetry/api` in transitively — that's all you need to *emit*
spans. To *export* them, add the OpenTelemetry Node SDK and an exporter (these are OpenTelemetry
packages, peers of your app, not `@benzene/*` packages):

```bash
npm install @benzene/diagnostics
npm install @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
```

For the cross-service worker example, also add the outbound SQS client and the SQS transport:

```bash
npm install @benzene/clients @benzene/clients-aws-sqs @benzene/aws-lambda-sqs @aws-sdk/client-sqs
```

## Step 1 — enable automatic span-per-middleware

`addDiagnostics()` wraps every middleware in every pipeline in an OpenTelemetry span, tagged with
`benzene.transport` / `benzene.topic` / `benzene.version` / `benzene.handler` / `benzene.status` where
resolvable. You never opt in per middleware — call it once at startup, alongside `addBenzene`:

```ts
import { addBenzene, addBenzeneMessage } from '@benzene/core-message-handlers';
import { addDiagnostics } from '@benzene/diagnostics';

addBenzene(container);
addBenzeneMessage(container);
addDiagnostics(container);
```

Do this on **both** services. Until Step 5 wires up an SDK, the API's no-op tracer makes every span
non-recording — the decorator ends it immediately and calls the inner middleware directly, so enabling
`addDiagnostics()` costs effectively nothing.

## Step 2 — the pipeline: continue the trace, enrich, measure

Add three middleware around your handlers. `useW3CTraceContext` (from `@benzene/diagnostics`) must be
**first** — it reads the inbound `traceparent` header and starts the pipeline's root span parented on
the remote trace, so a trace started upstream continues here instead of starting over. Then
`useBenzeneEnrichment` (ties log lines to the trace via `traceId`/`spanId`) and `useBenzeneMetrics`
(the once-per-message counter + histogram):

```ts
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { BenzeneMessageContext } from '@benzene/core-messages';
import {
  useBenzeneEnrichment,
  useBenzeneMetrics,
  useW3CTraceContext,
} from '@benzene/diagnostics';
import { CreateOrderHandler } from './createOrderHandler.js';

const pipeline = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
useW3CTraceContext(pipeline); // FIRST: parent the root span on the inbound traceparent
useBenzeneEnrichment(pipeline);
useBenzeneMetrics(pipeline);
useMessageHandlers(pipeline, CreateOrderHandler);
```

`useW3CTraceContext` falls back to a normal, parentless root span when the header is missing or fails
to parse, so it is always safe to add first — on HTTP, SQS, or any transport that registers an
`IMessageHeadersGetter<TContext>` (every built-in transport does).

## Step 3 — add your own business spans

The pipeline's span tree comes from Benzene. Inside a handler you add **child spans** on any
OpenTelemetry tracer; they nest under the active pipeline span automatically. `BenzeneDiagnostics.tracer`
(the shared `"Benzene"` tracer) is one option, but a tracer named for your own module keeps your spans
distinguishable:

```ts
import { SpanKind, trace } from '@opentelemetry/api';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';
import { BenzeneResult } from '@benzene/results';

const tracer = trace.getTracer('myapp.orders');

export class CreateOrderRequest {
  customerId = '';
}
export class CreateOrderResponse {
  orderId = '';
}

@message('order:create', { requestType: CreateOrderRequest, responseType: CreateOrderResponse })
export class CreateOrderHandler implements IMessageHandler<CreateOrderRequest, CreateOrderResponse> {
  async handleAsync(request: CreateOrderRequest): Promise<IBenzeneResultOf<CreateOrderResponse>> {
    // A child span under the active pipeline span; always ended, even on throw.
    await tracer.startActiveSpan('Payment.Charge', { kind: SpanKind.INTERNAL }, async (span) => {
      span.setAttribute('order.customerId', request.customerId);
      span.end();
    });

    const response = new CreateOrderResponse();
    response.orderId = `order-${request.customerId}`;
    return BenzeneResult.created(response);
  }
}
```

`useBenzeneEnrichment` reads the active span's `traceId`/`spanId` into the log scope, so any log line a
handler writes carries the same trace ids as the spans — see
[Monitoring — Structured log scopes](../monitoring.md#structured-log-scopes).

## Step 4 — propagate the trace onto the outbound message

The API doesn't call the worker directly — it puts a message on SQS via
[`@benzene/clients`](../clients.md) outbound routing. Add the **outbound** `useW3CTraceContext` (note:
imported from `@benzene/clients`, not `@benzene/diagnostics`) to the route. It stamps the active span's
`traceparent`/`tracestate` onto the outgoing message's headers, which the SQS converter forwards as
message attributes — so the trace context genuinely goes out on the wire:

```ts
import { SQSClient } from '@aws-sdk/client-sqs';
import { addOutboundRouting } from '@benzene/clients';
import { useW3CTraceContext } from '@benzene/clients'; // outbound counterpart
import { useSqs } from '@benzene/clients-aws-sqs';

const sqs = new SQSClient({});

addOutboundRouting(container, (routing) =>
  routing.route('order:process', (route) => {
    useW3CTraceContext(route); // stamp traceparent/tracestate onto the message headers
    useSqs(route, process.env.ORDERS_QUEUE_URL!, sqs);
  }),
);
```

The handler injects the `IBenzeneMessageSender` and sends by topic — no queue URL, no client type at
the call site:

```ts
import { IBenzeneMessageSender } from '@benzene/clients';

@message('order:create', { requestType: CreateOrderRequest, responseType: CreateOrderResponse })
export class CreateOrderHandler implements IMessageHandler<CreateOrderRequest, CreateOrderResponse> {
  static readonly inject = [IBenzeneMessageSender] as const;
  constructor(private readonly sender: IBenzeneMessageSender) {}

  async handleAsync(request: CreateOrderRequest): Promise<IBenzeneResultOf<CreateOrderResponse>> {
    const orderId = `order-${request.customerId}`;
    const result = await this.sender.sendAsync<{ orderId: string }, void>('order:process', { orderId });
    return result.isSuccessful
      ? BenzeneResult.created({ orderId } as CreateOrderResponse)
      : BenzeneResult.serviceUnavailable('Failed to queue order');
  }
}
```

## Step 5 — the worker picks the trace back up

The SQS worker's pipeline puts `useW3CTraceContext` (the **inbound** one, from `@benzene/diagnostics`)
first, exactly as the API's HTTP pipeline did in Step 2. It reads the `traceparent` the API stamped and
parents its own root span on it, so both services share **one** trace id:

```ts
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { BenzeneConfiguration, BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzene/core-message-handlers';
import { AwsLambdaHost, useAwsLambda } from '@benzene/aws-lambda-core';
import { useSqs } from '@benzene/aws-lambda-sqs';
import { addDiagnostics, useW3CTraceContext } from '@benzene/diagnostics';
import { ProcessOrderHandler } from './processOrderHandler.js';

export class ProcessOrderStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    addBenzene(services);
    addDiagnostics(services);
  }

  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useAwsLambda(app, (aws) =>
      useSqs(aws, (sqs) => {
        useW3CTraceContext(sqs); // FIRST: continue the trace the API stamped onto the message
        useMessageHandlers(sqs, ProcessOrderHandler);
      }),
    );
  }
}

// `.lambdaHandler` closes over the host and keeps `this` bound; assigning the method directly detaches it.
export const handler = new AwsLambdaHost(ProcessOrderStartUp).lambdaHandler;
```

That's the whole loop: the API's outbound route stamps `traceparent` (Step 4), the worker's inbound
`useW3CTraceContext` reads it back (Step 5), and Jaeger shows one continuous trace across both services.

> The outbound/inbound `useW3CTraceContext` pair is fully generic — it works on any pipeline with an
> `IMessageHeadersGetter<TContext>`, which every built-in transport registers (`useApiGateway`,
> `useSqs`, `useSns`, `useKafka`, `useEventHub`, on both AWS and Azure). SNS/Kafka/Event Hub carry the
> same story as SQS here.

## Step 6 — export to a real backend

`addDiagnostics()` produces spans, but they go nowhere until your app registers an OpenTelemetry SDK
with an exporter. Do this **once, before your Benzene entry point runs**, on each service — there is no
Benzene-specific registration:

```ts
// tracing.ts — imported at the very top of your entry module, before anything else.
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' }),
});

sdk.start();
```

Once this is registered, `addDiagnostics()`'s spans become recording (so they get tagged and exported)
and your handler's child spans flow through the same exporter. Benzene resolves the tracer lazily on
each use, so it always binds to whatever provider is registered at the time.

Run Jaeger's all-in-one image locally — it accepts OTLP directly, no separate collector needed:

```yaml
# docker-compose.yaml
services:
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"   # UI: http://localhost:16686
      - "4318:4318"     # OTLP HTTP receiver
```

For production, swap Jaeger for an [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/)
that fans out to whatever backend you run — nothing else in this cookbook changes.

## Testing

You don't need a backend to assert the trace shape. Register an **in-memory span exporter** as the
global tracer provider (the same approach the port's own diagnostics suite uses), send a message
through the pipeline, and inspect the finished spans. Because Benzene binds the tracer lazily, spans
land in your exporter with no other change:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { context as otelContext } from '@opentelemetry/api';

const spanExporter = new InMemorySpanExporter();

beforeEach(() => {
  otelContext.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] }),
  );
});

afterEach(() => {
  spanExporter.reset();
  trace.disable();
  otelContext.disable();
});

describe('order pipeline tracing', () => {
  it('produces a span-per-middleware plus the Payment.Charge child span', async () => {
    // buildApp() is your Step 1–3 wiring; send a message through the front door.
    const { app, factory } = buildApp();
    const request = Object.assign(new BenzeneMessageRequest(), {
      topic: 'order:create',
      body: JSON.stringify({ customerId: 'cust-1' }),
      headers: {},
    });

    await app.handleAsync(request, factory);

    const names = spanExporter.getFinishedSpans().map((s) => s.name);
    expect(names).toContain('Payment.Charge');
    // Every span in one send shares a trace id (a real context manager propagates it across awaits).
    const traceIds = new Set(spanExporter.getFinishedSpans().map((s) => s.spanContext().traceId));
    expect(traceIds.size).toBe(1);
  });
});
```

The real thing runs end to end in the port's `examples/opentelemetry` project — its test boots the app
and asserts both the dispatch outcome and the emitted spans (the span-per-middleware, the nested
business spans sharing the root trace id, and the error span for a failing handler). See
[Testing Benzene](../testing-benzene.md) for the wider testing guide.

## Troubleshooting

- **No spans appear at all.** Confirm you called `addDiagnostics(services)` *and* started an
  OpenTelemetry SDK before the first message. With no SDK the API's tracer is a no-op and Benzene's
  spans are non-recording **by design** — this is not a bug and not a sampler issue. See
  [Monitoring](../monitoring.md).
- **Two separate traces instead of one.** Confirm `useW3CTraceContext` is the **first** middleware on
  the receiving side, and that the **outbound** `useW3CTraceContext` (from `@benzene/clients`) is on
  the route used to send. Both are required for continuity.
- **`useW3CTraceContext` fails to resolve.** It resolves `IMessageHeadersGetter<TContext>` for the
  pipeline's context type. Every built-in transport registers it; on a custom pipeline, register the
  header getter first.
- **Failures vanish under low trace sampling.** Head-based ratio sampling decides before the handler
  runs, so it drops failures at the same rate as successes. See
  [Sampling Strategies — error-aware sampling](../sampling-strategies.md#keeping-the-traces-that-matter-error-aware-sampling).

## Variations

### Console exporter for local debugging

Swap the OTLP exporter for `ConsoleSpanExporter` (from `@opentelemetry/sdk-trace-base`) to print spans
to stdout instead of running a backend — handy for checking spans nest the way you expect before wiring
a collector.

### Export metrics alongside traces

Pair this with [Custom Metrics with OpenTelemetry](custom-metrics-opentelemetry.md) — `useBenzeneMetrics`
is already in the Step 2 pipeline; add a `metricReader` to the same `NodeSDK` and Benzene's
`benzene.messages.processed` / `benzene.message.duration` flow through the same exporter.

## See also

- [Monitoring & Diagnostics](../monitoring.md) — the full tracing/metrics/logging picture and wiring a
  real backend.
- [Sampling Strategies](../sampling-strategies.md) — controlling how much trace data you keep.
- [Request Correlation Across Services](request-correlation.md) — when to reach for the header-based
  correlation id alongside W3C trace context.
- [Custom Metrics with OpenTelemetry](custom-metrics-opentelemetry.md) — the metrics counterpart.
- [Clients](../clients.md) — outbound routing and per-transport header forwarding.
- [Correlation Ids](../correlation-ids.md) — the per-invocation marker for logs.

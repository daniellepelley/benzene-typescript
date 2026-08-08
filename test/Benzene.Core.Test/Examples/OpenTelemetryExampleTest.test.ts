/**
 * Drives `@benzene-example/opentelemetry` end-to-end with an in-memory OpenTelemetry span exporter (the
 * same `OtelHarness` the port's own diagnostics tests use — no otel-lgtm collector needed). Ports the
 * dispatch assertions of the .NET `SendEndpointTest` AND additionally asserts on the emitted spans, which
 * is the whole point of the example: `@benzene/diagnostics` produces one span per pipeline middleware, and
 * the handlers add business child spans (`Payment.Charge`, `Warehouse.*`) under them.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SpanStatusCode } from '@opentelemetry/api';
import { buildOtelApp, sendMessage } from '@benzene-example/opentelemetry';
import { OtelHarness } from '../Diagnostics/otelHarness';

const harness = new OtelHarness();
beforeEach(() => harness.start());
afterEach(() => harness.stop());

describe('@benzene-example/opentelemetry', () => {
  it('greeting: dispatches the handler, returns ok, and emits the span-per-middleware', async () => {
    const result = await sendMessage(buildOtelApp(), { topic: 'greeting', body: '{"name":"acme"}' });

    expect(result.statusCode).toBe('ok');
    expect(result.body).toContain('Hello, acme!');
    expect(result.traceId).toBeDefined();

    // One span per Benzene middleware (from addDiagnostics), plus the root Send span.
    const names = harness.spans().map((s) => s.name);
    expect(names).toContain('Send greeting');
    expect(names).toContain('MessageRouter');
    expect(names).toContain('BenzeneMetrics');
  });

  it('order_create: runs through the warehouse service and nests its business spans', async () => {
    const result = await sendMessage(buildOtelApp(), {
      topic: 'order_create',
      body: '{"productId":"prod-1","quantity":2}',
    });

    expect(result.statusCode).toBe('created');
    expect(result.body).toContain('prod-1');

    const names = harness.spans().map((s) => s.name);
    expect(names).toContain('Payment.Charge');
    expect(names).toContain('Warehouse.ReserveStock');
    expect(names).toContain('Warehouse.Dispatch');

    // The business spans nest under the pipeline: same trace id as the root Send span.
    const send = harness.span('Send order_create');
    const payment = harness.span('Payment.Charge');
    expect(payment.spanContext().traceId).toBe(send.spanContext().traceId);
  });

  it('order_fail: the framework catches the throw (non-success status) and the span is an error span', async () => {
    const result = await sendMessage(buildOtelApp(), {
      topic: 'order_fail',
      body: '{"reason":"card-declined"}',
    });

    // The envelope comes back with a non-success status; the app keeps running.
    expect(result.statusCode).not.toBe('ok');
    expect(result.statusCode).not.toBe('created');

    const payment = harness.span('Payment.Charge');
    expect(payment.status.code).toBe(SpanStatusCode.ERROR);
    expect(payment.events.some((e) => e.name === 'exception')).toBe(true);
  });
});

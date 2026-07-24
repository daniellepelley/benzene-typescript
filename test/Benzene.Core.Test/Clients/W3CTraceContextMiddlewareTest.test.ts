import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { trace } from '@opentelemetry/api';
import {
  addOutboundRouting,
  IBenzeneMessageSender,
  OutboundContext,
  useW3CTraceContext,
  W3CTraceContextMiddleware,
} from '@benzene/clients';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { BenzeneResult } from '@benzene/results';
import { OtelHarness } from '../Diagnostics/otelHarness';

/**
 * Port of test/Benzene.Core.Test/Clients/W3CTraceContextMiddlewareTest.cs. The C# `ActivitySource` +
 * `ActivityListener` are replaced by the in-memory OpenTelemetry harness (a tracer provider + context
 * manager), so `trace.getActiveSpan()` returns a real span with a valid span context.
 */

const harness = new OtelHarness();
beforeEach(() => harness.start());
afterEach(() => harness.stop());

function expectedTraceparent(traceId: string, spanId: string, traceFlags: number): string {
  return `00-${traceId}-${spanId}-${traceFlags.toString(16).padStart(2, '0')}`;
}

describe('W3CTraceContextMiddleware (outbound)', () => {
  it('an active span stamps traceparent onto the context headers, and calls next', async () => {
    await trace.getTracer('test').startActiveSpan('outbound-call', async (span) => {
      const context = new OutboundContext('my-topic', 'hello');
      let nextCalled = false;

      await new W3CTraceContextMiddleware().handleAsync(context, () => {
        nextCalled = true;
        return Promise.resolve();
      });

      const sc = span.spanContext();
      expect(nextCalled).toBe(true);
      expect(context.headers.traceparent).toBe(expectedTraceparent(sc.traceId, sc.spanId, sc.traceFlags));
      span.end();
    });
  });

  it('does not mutate the caller header object (only the context copy)', async () => {
    await trace.getTracer('test').startActiveSpan('outbound-call', async (span) => {
      const callerHeaders: Record<string, string> = {};
      const context = new OutboundContext('my-topic', 'hello', callerHeaders);

      await new W3CTraceContextMiddleware().handleAsync(context, () => Promise.resolve());

      expect('traceparent' in context.headers).toBe(true);
      expect('traceparent' in callerHeaders).toBe(false);
      span.end();
    });
  });

  it('leaves headers unchanged when there is no ambient span', async () => {
    const context = new OutboundContext('my-topic', 'hello');

    await new W3CTraceContextMiddleware().handleAsync(context, () => Promise.resolve());

    expect('traceparent' in context.headers).toBe(false);
  });

  it('useW3CTraceContext on a route carries the trace onto the sent message', async () => {
    const container = new DefaultBenzeneServiceContainer();
    let stampedTraceparent: string | undefined;
    addOutboundRouting(container, (routing) =>
      routing.route('order:created', (pipeline) => {
        useW3CTraceContext(pipeline);
        pipeline.onRequest((ctx) => {
          stampedTraceparent = ctx.headers.traceparent;
          ctx.response = BenzeneResult.accepted();
        });
      }),
    );
    const sender = container.createServiceResolverFactory().createScope().getService(IBenzeneMessageSender);

    await trace.getTracer('test').startActiveSpan('inbound', async (span) => {
      await sender.sendAsync('order:created', { id: 1 });
      expect(stampedTraceparent).toBe(
        expectedTraceparent(span.spanContext().traceId, span.spanContext().spanId, span.spanContext().traceFlags),
      );
      span.end();
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { useW3CTraceContext } from '@benzene/diagnostics';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { OtelHarness } from './otelHarness';

/**
 * Span-level port of the C# W3CTraceContext tests: `useW3CTraceContext` starts the pipeline's root span
 * parented to the inbound `traceparent`, so the root span inherits the remote trace-id (distributed
 * traces continue across the hop). The header parsing/validation itself is covered by the existing
 * W3CTraceContextTest (over `parseTraceparent`).
 */

const harness = new OtelHarness();
beforeEach(() => harness.start());
afterEach(() => harness.stop());

const remoteTraceId = '0af7651916cd43dd8448eb211c80319c';

async function runWith(headers: Record<string, string>): Promise<void> {
  const container = new DefaultBenzeneServiceContainer();
  const headersGetter: IMessageHeadersGetter<object> = { getHeaders: () => headers };
  container.addScopedInstance(IMessageHeadersGetter, headersGetter as IMessageHeadersGetter<unknown>);

  const builder = new MiddlewarePipelineBuilder<object>(container);
  useW3CTraceContext(builder);

  const resolver = container.createServiceResolverFactory().createScope();
  await builder.build().handleAsync({}, resolver);
}

describe('useW3CTraceContext', () => {
  it('a valid traceparent becomes the root span parent (trace-id continues)', async () => {
    await runWith({ traceparent: `00-${remoteTraceId}-b7ad6b7169203331-01` });

    expect(harness.span('W3CTraceContext.Root').spanContext().traceId).toBe(remoteTraceId);
  });

  it('a missing traceparent starts a new, unrelated root trace without throwing', async () => {
    await runWith({});

    const span = harness.span('W3CTraceContext.Root');
    expect(span.spanContext().traceId).not.toBe(remoteTraceId);
    expect(span.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('an invalid traceparent falls back to a new root trace without throwing', async () => {
    await runWith({ traceparent: 'not-a-valid-traceparent' });

    expect(harness.span('W3CTraceContext.Root').spanContext().traceId).not.toBe(remoteTraceId);
  });
});

/**
 * Outbound trace context propagation (mesh.md §3; M2 of the meshed-service claim, §7.1): within a traced
 * invocation, `useMeshTraceContext` on an outbound route forwards `traceparent` (built from the span
 * `useMeshTrace` assigned) and the caller's `tracestate` on every outbound message - a send, and a published
 * event (`@benzenejs/response-events` publishes through the same `IBenzeneMessageSender` routes).
 */
import { describe, expect, it } from 'vitest';
import { IMiddlewarePipelineBuilder } from '@benzenejs/abstractions-middleware';
import { addOutboundRouting, IBenzeneMessageSender, OutboundContext } from '@benzenejs/clients';
import { BenzeneMessageContext, BenzeneMessageRequest } from '@benzenejs/core-messages';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import {
  addBenzene,
  addBenzeneMessage,
  addContextItems,
  BenzeneMessageApplication,
} from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { BenzeneMessageSenderResponseEventPublisher } from '@benzenejs/response-events';
import { BenzeneResult } from '@benzenejs/results';
import {
  IMeshTraceExporter,
  MeshServiceInfo,
  MeshTraceEvent,
  useMeshTrace,
  useMeshTraceContext,
} from '@benzenejs/mesh-wire';

class CapturingExporter implements IMeshTraceExporter {
  readonly events: MeshTraceEvent[] = [];
  export(traceEvent: MeshTraceEvent): void {
    this.events.push(traceEvent);
  }
}

const callerTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
const callerSpanId = '00f067aa0ba902b7';
const callerTraceparent = `00-${callerTraceId}-${callerSpanId}-01`;

/** An outbound sender whose routes forward the mesh trace context and record what reached the wire. */
function outboundSender(): { sent: Map<string, Record<string, string>>; sender: IBenzeneMessageSender } {
  const sent = new Map<string, Record<string, string>>();
  const container = new DefaultBenzeneServiceContainer();
  const record = (topic: string) => (pipeline: IMiddlewarePipelineBuilder<OutboundContext>) => {
    useMeshTraceContext(pipeline);
    pipeline.onRequest((ctx) => {
      sent.set(topic, { ...ctx.headers });
      ctx.response = BenzeneResult.accepted();
    });
  };
  addOutboundRouting(container, (routing) =>
    routing
      .route('payment:take', record('payment:take'))
      .route('order:placed', record('order:placed')),
  );
  const sender = container.createServiceResolverFactory().createScope().getService(IBenzeneMessageSender);
  return { sent, sender };
}

/** Runs one traced inbound invocation whose handler sends `payment:take` and publishes `order:placed`. */
async function tracedInvocation(
  sender: IBenzeneMessageSender,
  headers: Record<string, string>,
): Promise<CapturingExporter> {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addBenzeneMessage(container);
  addContextItems(container);
  const builder = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
  const exporter = new CapturingExporter();
  useMeshTrace(builder, new MeshServiceInfo('orders'), exporter);
  builder.useFn('Handler', async () => {
    await sender.sendAsync('payment:take', { orderId: 'o-1' });
    await new BenzeneMessageSenderResponseEventPublisher(sender).publishAsync('order:placed', { orderId: 'o-1' });
  });

  const request = new BenzeneMessageRequest();
  request.topic = 'order:create';
  request.headers = headers;
  request.body = '{}';
  await new BenzeneMessageApplication(builder.build()).handleAsync(request, container.createServiceResolverFactory());
  return exporter;
}

describe('useMeshTraceContext (M2: outbound propagation)', () => {
  it('forwards traceparent and tracestate on a send and on a published event', async () => {
    const { sent, sender } = outboundSender();

    const exporter = await tracedInvocation(sender, { traceparent: callerTraceparent, tracestate: 'vendor=abc' });

    const invocation = exporter.events[0]!;
    expect(invocation.traceId).toBe(callerTraceId);
    const expected = `00-${callerTraceId}-${invocation.spanId}-01`;
    for (const topic of ['payment:take', 'order:placed']) {
      expect(sent.get(topic)?.['traceparent'], topic).toBe(expected);
      expect(sent.get(topic)?.['tracestate'], topic).toBe('vendor=abc');
    }
  });

  it('starts the trace here when the caller sent none, and forwards it', async () => {
    const { sent, sender } = outboundSender();

    const exporter = await tracedInvocation(sender, {});

    const invocation = exporter.events[0]!;
    expect(sent.get('order:placed')?.['traceparent']).toBe(`00-${invocation.traceId}-${invocation.spanId}-01`);
    expect(sent.get('order:placed')?.['tracestate']).toBeUndefined();
  });

  it('discards a tracestate that arrived beside a malformed traceparent', async () => {
    const { sent, sender } = outboundSender();

    await tracedInvocation(sender, { traceparent: 'not-a-traceparent', tracestate: 'vendor=abc' });

    expect(sent.get('payment:take')?.['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(sent.get('payment:take')?.['tracestate']).toBeUndefined();
  });

  it('adds nothing outside a traced invocation, and keeps a traceparent the caller set', async () => {
    const { sent, sender } = outboundSender();

    await sender.sendAsync('payment:take', {});
    expect(sent.get('payment:take')?.['traceparent']).toBeUndefined();

    const explicit = `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`;
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addBenzeneMessage(container);
    addContextItems(container);
    const builder = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
    useMeshTrace(builder, new MeshServiceInfo('orders'), new CapturingExporter());
    builder.useFn('Handler', async () => {
      await sender.sendAsync('payment:take', {}, { traceparent: explicit });
    });
    const request = new BenzeneMessageRequest();
    request.topic = 'order:create';
    request.headers = {};
    request.body = '{}';
    await new BenzeneMessageApplication(builder.build()).handleAsync(request, container.createServiceResolverFactory());

    expect(sent.get('payment:take')?.['traceparent']).toBe(explicit);
  });
});

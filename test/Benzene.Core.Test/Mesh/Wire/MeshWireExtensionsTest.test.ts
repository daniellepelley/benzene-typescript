/**
 * Port of Benzene.Test.Mesh.Wire.ExtensionsTest: drive a real BenzeneMessage pipeline and assert the
 * reserved `benzene:mesh` topic (plus aliases) short-circuits with the descriptor while every other topic falls
 * through (UseMeshDescriptor), and that the trace feed produces a `MeshTraceEvent` per invocation with
 * W3C trace-context join semantics, ambient `MeshSpan` propagation, and full §6 degradation
 * (UseMeshTrace). Mockito's `Mock<IMeshTraceExporter>` maps to a small capturing/throwing fake.
 */
import { describe, expect, it } from 'vitest';
import { BenzeneMessageContext, BenzeneMessageRequest } from '@benzenejs/core-messages';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { BenzeneResultStatus } from '@benzenejs/results';
import {
  addBenzene,
  addBenzeneMessage,
  addContextItems,
  BenzeneMessageApplication,
} from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import {
  BenzeneMessageMeshStatusReader,
  IMeshTraceExporter,
  MeshServiceDescriptor,
  MeshServiceInfo,
  MeshSpan,
  MeshTopics,
  MeshTraceEvent,
  useMeshDescriptor,
  useMeshTrace,
} from '@benzenejs/mesh-wire';

/** Captures every exported event (the port of the tests' `Mock<IMeshTraceExporter>` + callback). */
class CapturingExporter implements IMeshTraceExporter {
  readonly events: MeshTraceEvent[] = [];
  export(traceEvent: MeshTraceEvent): void {
    this.events.push(traceEvent);
  }
}

/** Throws on every export (the port of the mock set up to throw). */
class ThrowingExporter implements IMeshTraceExporter {
  calls = 0;
  export(): void {
    this.calls++;
    throw new Error('boom');
  }
}

function newPipeline(): {
  builder: MiddlewarePipelineBuilder<BenzeneMessageContext>;
  container: DefaultBenzeneServiceContainer;
} {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addBenzeneMessage(container);
  // Registers the default IMessageGetter/IMessageHandlerResultSetter mappers (the C# test's AddContextItems);
  // useMeshDescriptor resolves both. Normally useMessageHandlers pulls these in, but this pipeline has none.
  addContextItems(container);
  return { builder: new MiddlewarePipelineBuilder<BenzeneMessageContext>(container), container };
}

function descriptorFor(service: string): MeshServiceDescriptor {
  const descriptor = new MeshServiceDescriptor();
  descriptor.service = service;
  return descriptor;
}

async function send(
  builder: MiddlewarePipelineBuilder<BenzeneMessageContext>,
  container: DefaultBenzeneServiceContainer,
  topic: string,
  headers: Record<string, string> = {},
) {
  const app = new BenzeneMessageApplication(builder.build());
  const request = new BenzeneMessageRequest();
  request.topic = topic;
  request.headers = headers;
  request.body = '';
  return app.handleAsync(request, container.createServiceResolverFactory());
}

describe('MeshWireExtensionsTest', () => {
  it('UseMeshDescriptor_MatchingTopic_ShortCircuitsWithTheDescriptor', async () => {
    const { builder, container } = newPipeline();
    useMeshDescriptor(builder, descriptorFor('orders-service'));

    const response = await send(builder, container, MeshTopics.descriptor);

    expect(response.statusCode).toBe(BenzeneResultStatus.ok);
    expect(response.body).toContain('orders-service');
  });

  it('UseMeshDescriptor_AliasTopic_ShortCircuitsWithTheDescriptor', async () => {
    const { builder, container } = newPipeline();
    useMeshDescriptor(builder, descriptorFor('orders-service'), 'orders.mesh');

    const response = await send(builder, container, 'orders.mesh');

    expect(response.statusCode).toBe(BenzeneResultStatus.ok);
    expect(response.body).toContain('orders-service');
  });

  it('UseMeshDescriptor_NonMatchingTopic_FallsThroughToNextMiddleware', async () => {
    const { builder, container } = newPipeline();
    let nextRan = false;
    useMeshDescriptor(builder, descriptorFor('orders-service'));
    builder.useFn('Terminal', (_context, next) => {
      nextRan = true;
      return next();
    });

    await send(builder, container, 'some-other-topic');

    expect(nextRan).toBe(true);
  });

  it('UseMeshTrace_NullExporter_IsAPassThrough', async () => {
    const { builder, container } = newPipeline();
    let nextRan = false;
    useMeshTrace(builder, new MeshServiceInfo('orders-service'), undefined);
    builder.useFn('Terminal', (_context, next) => {
      nextRan = true;
      return next();
    });

    await send(builder, container, 'some-topic');

    expect(nextRan).toBe(true);
  });

  it('UseMeshTrace_SuccessfulInvocation_ExportsATraceEventWithTopicAndStatus', async () => {
    const { builder, container } = newPipeline();
    const exporter = new CapturingExporter();
    useMeshTrace(builder, new MeshServiceInfo('orders-service'), exporter, new BenzeneMessageMeshStatusReader());
    useMeshDescriptor(builder, descriptorFor('orders-service'));

    await send(builder, container, MeshTopics.descriptor);

    expect(exporter.events).toHaveLength(1);
    const exported = exporter.events[0]!;
    expect(exported.topic).toBe(MeshTopics.descriptor);
    expect(exported.service).toBe('orders-service');
    expect(exported.status).toBe(BenzeneResultStatus.ok);
    expect(exported.durationMs).toBeGreaterThanOrEqual(0);
    expect(exported.traceId).not.toBe('');
    expect(exported.spanId).not.toBe('');
  });

  it('UseMeshTrace_NoIncomingTraceparent_StartsANewTrace', async () => {
    const { builder, container } = newPipeline();
    const exporter = new CapturingExporter();
    useMeshTrace(builder, new MeshServiceInfo('orders-service'), exporter);

    await send(builder, container, 'some-topic');

    const exported = exporter.events[0]!;
    expect(exported.traceId).toHaveLength(32);
    expect(exported.parentSpanId).toBeUndefined();
  });

  it('UseMeshTrace_ValidIncomingTraceparent_JoinsTheExistingTrace', async () => {
    const { builder, container } = newPipeline();
    const exporter = new CapturingExporter();
    useMeshTrace(builder, new MeshServiceInfo('orders-service'), exporter);

    const traceId = 'a'.repeat(32);
    const parentSpanId = 'b'.repeat(16);
    await send(builder, container, 'some-topic', { traceparent: `00-${traceId}-${parentSpanId}-01` });

    const exported = exporter.events[0]!;
    expect(exported.traceId).toBe(traceId);
    expect(exported.parentSpanId).toBe(parentSpanId);
  });

  it('UseMeshTrace_CanonicalCasedTraceparent_JoinsTheExistingTrace', async () => {
    // wire-contracts.md §2: header keys are case-insensitive on read. A Go service (net/http
    // canonicalizes to "Traceparent") must still join the trace rather than start a fresh one.
    const { builder, container } = newPipeline();
    const exporter = new CapturingExporter();
    useMeshTrace(builder, new MeshServiceInfo('orders-service'), exporter);

    const traceId = 'a'.repeat(32);
    const parentSpanId = 'b'.repeat(16);
    await send(builder, container, 'some-topic', { Traceparent: `00-${traceId}-${parentSpanId}-01` });

    const exported = exporter.events[0]!;
    expect(exported.traceId).toBe(traceId);
    expect(exported.parentSpanId).toBe(parentSpanId);
  });

  it('UseMeshTrace_MalformedTraceparent_StartsANewTraceInstead', async () => {
    const { builder, container } = newPipeline();
    const exporter = new CapturingExporter();
    useMeshTrace(builder, new MeshServiceInfo('orders-service'), exporter);

    await send(builder, container, 'some-topic', { traceparent: 'not-a-valid-traceparent' });

    const exported = exporter.events[0]!;
    expect(exported.traceId).toHaveLength(32);
    expect(exported.parentSpanId).toBeUndefined();
  });

  it('UseMeshTrace_ExporterThrows_DoesNotAffectTheResponse', async () => {
    const { builder, container } = newPipeline();
    const exporter = new ThrowingExporter();
    useMeshTrace(builder, new MeshServiceInfo('orders-service'), exporter);
    useMeshDescriptor(builder, descriptorFor('orders-service'));

    const response = await send(builder, container, MeshTopics.descriptor);

    expect(response.statusCode).toBe(BenzeneResultStatus.ok);
    expect(exporter.calls).toBe(1);
  });

  it('UseMeshTrace_NoStatusReader_RecordsAnEmptyStatus', async () => {
    const { builder, container } = newPipeline();
    const exporter = new CapturingExporter();
    useMeshTrace(builder, new MeshServiceInfo('orders-service'), exporter);
    useMeshDescriptor(builder, descriptorFor('orders-service'));

    await send(builder, container, MeshTopics.descriptor);

    expect(exporter.events[0]!.status).toBe('');
  });

  it('UseMeshTrace_CorrelationIdHeader_IsCapturedOnTheTraceEvent', async () => {
    const { builder, container } = newPipeline();
    const exporter = new CapturingExporter();
    useMeshTrace(builder, new MeshServiceInfo('orders-service'), exporter);

    await send(builder, container, 'some-topic', { 'x-correlation-id': 'corr-123' });

    expect(exporter.events[0]!.correlationId).toBe('corr-123');
  });

  it('UseMeshTrace_CanonicalCasedCorrelationIdHeader_IsCaptured', async () => {
    const { builder, container } = newPipeline();
    const exporter = new CapturingExporter();
    useMeshTrace(builder, new MeshServiceInfo('orders-service'), exporter);

    await send(builder, container, 'some-topic', { 'X-Correlation-Id': 'corr-123' });

    expect(exporter.events[0]!.correlationId).toBe('corr-123');
  });

  it('UseMeshTrace_DuringNext_MeshSpanCurrentIsSetThenRestoredAfterwards', async () => {
    const { builder, container } = newPipeline();
    const before = MeshSpan.current;
    let traceIdDuringNext: string | undefined;

    useMeshTrace(builder, new MeshServiceInfo('orders-service'), new CapturingExporter());
    builder.useFn('Capture', (_context, next) => {
      traceIdDuringNext = MeshSpan.current?.traceId;
      return next();
    });

    await send(builder, container, 'some-topic');

    expect(traceIdDuringNext).toBeDefined();
    expect(traceIdDuringNext).toHaveLength(32);
    expect(MeshSpan.current).toBe(before);
  });
});

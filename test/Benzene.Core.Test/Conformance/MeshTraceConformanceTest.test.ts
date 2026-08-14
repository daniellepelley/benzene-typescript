/**
 * Runs docs/specification/conformance/mesh-trace-cases.json against the TypeScript port: the whole
 * BenzeneMessage pipeline with the mesh trace middleware installed outermost (mesh.md §3) - the
 * traceparent join/reject rules, and the invocation → semantic-status mapping including the
 * `conformance:panic` handler's exception rule (an unhandled throw is traced as `service-unavailable`,
 * never lost).
 */
import { describe, expect, it } from 'vitest';
import { BenzeneMessageContext, BenzeneMessageRequest } from '@benzenejs/core-messages';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import {
  addBenzene,
  addBenzeneMessage,
  BenzeneMessageApplication,
  useMessageHandlers,
} from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import {
  BenzeneMessageMeshStatusReader,
  IMeshTraceExporter,
  MeshJson,
  MeshServiceInfo,
  MeshTraceEvent,
  useMeshTrace,
} from '@benzenejs/mesh-wire';
import { findSubsetMismatch, load } from './ConformanceFixtures';
import { GreetConformanceHandler } from './Handlers/GreetConformanceHandler';
import { StatusConformanceHandler } from './Handlers/StatusConformanceHandler';
import { PanicConformanceHandler } from './Handlers/PanicConformanceHandler';

interface TraceFixture {
  traceparent: {
    name: string;
    header: string;
    valid: boolean;
    traceId?: string;
    parentSpanId?: string;
  }[];
  invocations: {
    name: string;
    request: { topic: string; headers: Record<string, string>; body: string };
    expectedEvent: unknown;
  }[];
}

const fixture = load<TraceFixture>('mesh-trace-cases.json');

class CaptureExporter implements IMeshTraceExporter {
  readonly events: MeshTraceEvent[] = [];
  export(traceEvent: MeshTraceEvent): void {
    this.events.push(traceEvent);
  }
}

async function runTraced(request: BenzeneMessageRequest): Promise<MeshTraceEvent> {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addBenzeneMessage(container);

  const exporter = new CaptureExporter();
  const builder = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
  useMeshTrace(builder, new MeshServiceInfo('conformance'), exporter, new BenzeneMessageMeshStatusReader());
  useMessageHandlers(builder, GreetConformanceHandler, StatusConformanceHandler, PanicConformanceHandler);

  const application = new BenzeneMessageApplication(builder.build());
  await application.handleAsync(request, container.createServiceResolverFactory());

  expect(exporter.events).toHaveLength(1);
  return exporter.events[0]!;
}

function request(topic: string, headers: Record<string, string>, body: string): BenzeneMessageRequest {
  const req = new BenzeneMessageRequest();
  req.topic = topic;
  req.headers = headers;
  req.body = body;
  return req;
}

describe('MeshTraceConformanceTest', () => {
  describe('traceparent join/reject', () => {
    for (const testCase of fixture.traceparent) {
      it(testCase.name, async () => {
        const headers: Record<string, string> = {};
        if (testCase.header !== '') {
          headers['traceparent'] = testCase.header;
        }

        const traceEvent = await runTraced(request('conformance:greet', headers, '{"name":"world"}'));

        if (testCase.valid) {
          expect(traceEvent.traceId).toBe(testCase.traceId);
          expect(traceEvent.parentSpanId).toBe(testCase.parentSpanId);
          expect(traceEvent.spanId).not.toBe(testCase.parentSpanId);
          return;
        }

        expect(traceEvent.parentSpanId).toBeUndefined();
        expect(traceEvent.traceId).toHaveLength(32);
        expect(traceEvent.traceId).toMatch(/^[0-9a-f]+$/);
        const segments = testCase.header.split('-');
        if (segments.length > 1) {
          expect(traceEvent.traceId).not.toBe(segments[1]);
        }
      });
    }
  });

  describe('invocation → semantic status', () => {
    for (const testCase of fixture.invocations) {
      it(testCase.name, async () => {
        const traceEvent = await runTraced(
          request(testCase.request.topic, testCase.request.headers, testCase.request.body),
        );

        const actual = JSON.parse(MeshJson.serialize(traceEvent)) as unknown;
        const mismatch = findSubsetMismatch(testCase.expectedEvent, actual);
        expect(mismatch, mismatch ?? undefined).toBeNull();

        expect(traceEvent.spanId).toHaveLength(16);
        expect(traceEvent.durationMs).toBeGreaterThanOrEqual(0);
        expect(traceEvent.startedAt).not.toBe(0);
      });
    }
  });
});

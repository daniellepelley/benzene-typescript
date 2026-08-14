import { describe, expect, it } from 'vitest';
import {
  BatchGetTracesCommand,
  GetTraceSummariesCommand,
  XRayClient,
} from '@aws-sdk/client-xray';
import { XRayTraceSource, XRayTraceSourceOptions } from '@benzenejs/mesh-fleet-aws-xray';

/**
 * Port of test/Benzene.Mesh.Test/XRayTraceSourceTest.cs. The X-Ray-backed trace source: fetch a trace's
 * segments with `BatchGetTraces` and map its topic-bearing spans into a `TraceView` (the fleet UI's waterfall
 * over X-Ray, no push collector). Reads the Benzene attributes the pipeline stamps whether X-Ray landed them
 * as annotations (underscore keys) or metadata (dotted keys), filters out the non-Benzene X-Ray spans, and
 * orders events by start time; also correlation grouping/paging and recent-flows enrichment.
 *
 * Moq `IAmazonXRay` -> a hand-rolled stub whose `send` routes on the command type (`BatchGetTracesCommand` /
 * `GetTraceSummariesCommand`) to the supplied handler and returns the canned response, the same "stub the
 * SDK client's `send`" idiom as `SqsHealthCheckTest`. The stub tracks the `BatchGetTraces` call count for the
 * "enrichment off => no fetch" assertion (the C# `Times.Never` verify).
 */

const TraceId = '1-581cf771-a006649127e371903a2de979';

type BatchInput = { TraceIds?: string[] };
type SummariesInput = { FilterExpression?: string; NextToken?: string; StartTime?: Date; EndTime?: Date };
type BatchHandler = (input: BatchInput) => unknown;
type SummariesHandler = (input: SummariesInput) => unknown;

/** A stub `XRayClient` whose `send` dispatches to the supplied handlers and counts BatchGetTraces calls. */
class XRayStub {
  batchCalls = 0;

  summariesCalls = 0;

  constructor(
    private readonly batchHandler?: BatchHandler,
    private readonly summariesHandler?: SummariesHandler,
  ) {}

  private readonly send = (command: unknown): Promise<unknown> => {
    if (command instanceof BatchGetTracesCommand) {
      this.batchCalls++;
      return Promise.resolve(this.batchHandler?.(command.input as BatchInput) ?? {});
    }
    if (command instanceof GetTraceSummariesCommand) {
      this.summariesCalls++;
      return Promise.resolve(this.summariesHandler?.(command.input as SummariesInput) ?? {});
    }
    return Promise.resolve({});
  };

  get client(): XRayClient {
    return { send: this.send } as unknown as XRayClient;
  }
}

/** Mirrors the C# `XRay(params string[] segmentDocuments)` helper: one trace (id = TraceId) of those docs. */
function batchOneTrace(...documents: string[]): BatchHandler {
  return () => ({ Traces: [{ Id: TraceId, Segments: documents.map((d) => ({ Document: d })) }] });
}

/** A minimal topic-bearing segment for the correlation tests (id/service/topic/correlation/start). */
function corrSegment(id: string, service: string, topic: string, correlationId: string, start: number): string {
  return `{
    "id": "${id}",
    "name": "${service}",
    "start_time": ${start},
    "end_time": ${start + 0.1},
    "annotations": {
      "benzene_topic": "${topic}",
      "benzene_status": "ok",
      "benzene_correlation_id": "${correlationId}"
    }
  }`;
}

/** Mirrors the C# `FlowSegment`: a topic-bearing segment carrying a benzene.service tag and a real start. */
function flowSegment(service: string, topic: string, startSeconds: number, endSeconds: number): string {
  const id = service.replace(/-/g, '') + '0001';
  return `{
    "id": "${id}",
    "name": "${service}-lambda-infra",
    "start_time": ${startSeconds},
    "end_time": ${endSeconds},
    "annotations": {
      "benzene_topic": "${topic}",
      "benzene_service": "${service}",
      "benzene_status": "ok"
    }
  }`;
}

describe('XRayTraceSource', () => {
  it('getTraceAsync maps topic-bearing spans from annotations, ordered by start time', async () => {
    // Root segment (orders-api) with a Benzene topic in annotations (underscore-sanitised keys), and a nested
    // subsegment for a downstream topic - the two topic-bearing spans of the flow.
    const segment = `{
      "id": "70de5b6f19ff9a0a",
      "name": "orders-api",
      "start_time": 1500000000.5,
      "end_time": 1500000000.9,
      "annotations": {
        "benzene_topic": "orders:create",
        "benzene_version": "v1",
        "benzene_status": "ok",
        "benzene_correlation_id": "ticket-42"
      },
      "subsegments": [
        {
          "id": "aaaabbbbccccdddd",
          "parent_id": "70de5b6f19ff9a0a",
          "name": "orders-api-internal",
          "start_time": 1500000000.6,
          "end_time": 1500000000.7,
          "annotations": {
            "benzene_topic": "inventory:reserve",
            "benzene_status": "not-found",
            "benzene_exception_type": "System.InvalidOperationException"
          }
        }
      ]
    }`;

    const source = new XRayTraceSource(new XRayStub(batchOneTrace(segment)).client);

    const view = await source.getTraceAsync(TraceId);

    expect(view).toBeDefined();
    expect(view!.traceId).toBe(TraceId);
    expect(view!.events).toHaveLength(2);

    // Ordered by start time: the root topic first, the subsegment second.
    const root = view!.events[0];
    expect(root.traceId).toBe(TraceId);
    expect(root.spanId).toBe('70de5b6f19ff9a0a');
    expect(root.parentSpanId).toBeUndefined();
    expect(root.service).toBe('orders-api');
    expect(root.topic).toBe('orders:create');
    expect(root.topicVersion).toBe('v1');
    expect(root.status).toBe('ok');
    expect(root.correlationId).toBe('ticket-42');
    expect(root.durationMs).toBeCloseTo(400, 3); // (0.9 - 0.5) * 1000, within float epoch precision
    expect(root.exceptionType).toBeUndefined(); // absent tag → undefined, never fabricated

    const child = view!.events[1];
    expect(child.spanId).toBe('aaaabbbbccccdddd');
    expect(child.parentSpanId).toBe('70de5b6f19ff9a0a');
    expect(child.service).toBe('orders-api'); // enclosing segment's name, not a new boundary
    expect(child.topic).toBe('inventory:reserve');
    expect(child.status).toBe('not-found');
    expect(child.exceptionType).toBe('System.InvalidOperationException'); // the failure's WHY (spec §3)
  });

  it('getTraceAsync prefers the benzene.service tag over the segment name', async () => {
    // On Lambda the X-Ray segment is named by ADOT after the handler ("ApiGatewayLambdaHandler"), not the
    // service. When the pipeline stamps benzene.service, the mapper must use it as the emitting service.
    const segment = `{
      "id": "70de5b6f19ff9a0a",
      "name": "ApiGatewayLambdaHandler",
      "start_time": 1500000000.5,
      "end_time": 1500000000.9,
      "annotations": {
        "benzene_topic": "orders:create",
        "benzene_service": "orders-api",
        "benzene_status": "ok"
      }
    }`;

    const source = new XRayTraceSource(new XRayStub(batchOneTrace(segment)).client);

    const view = await source.getTraceAsync(TraceId);

    expect(view!.events).toHaveLength(1);
    expect(view!.events[0].service).toBe('orders-api'); // the benzene.service tag, not "ApiGatewayLambdaHandler"
  });

  it('getTraceAsync falls back to the segment name when there is no benzene.service tag', async () => {
    // A span that predates the tag: the segment name remains the fallback service.
    const segment = `{
      "id": "70de5b6f19ff9a0a",
      "name": "orders-api",
      "start_time": 1500000000.5,
      "end_time": 1500000000.9,
      "annotations": { "benzene_topic": "orders:create", "benzene_status": "ok" }
    }`;

    const view = await new XRayTraceSource(new XRayStub(batchOneTrace(segment)).client).getTraceAsync(TraceId);

    expect(view!.events).toHaveLength(1);
    expect(view!.events[0].service).toBe('orders-api');
  });

  it('getTraceAsync reads Benzene attributes from namespaced metadata', async () => {
    // The OTel→X-Ray exporter can land span attributes in metadata under a namespace (dotted keys preserved)
    // rather than annotations - the reader must find them there too.
    const segment = `{
      "id": "1111222233334444",
      "name": "payments-api",
      "start_time": 1500000010,
      "end_time": 1500000010.25,
      "metadata": {
        "default": {
          "benzene.topic": "payments:charge",
          "benzene.version": "v2",
          "benzene.status": "unauthorized"
        }
      }
    }`;

    const source = new XRayTraceSource(new XRayStub(batchOneTrace(segment)).client);

    const view = await source.getTraceAsync(TraceId);

    expect(view).toBeDefined();
    expect(view!.events).toHaveLength(1);
    const evt = view!.events[0];
    expect(evt.topic).toBe('payments:charge');
    expect(evt.topicVersion).toBe('v2');
    expect(evt.status).toBe('unauthorized');
    expect(evt.service).toBe('payments-api');
    expect(evt.durationMs).toBeCloseTo(250, 3);
  });

  it('getTraceAsync skips non-Benzene spans', async () => {
    // A real X-Ray trace mixes in transport/AWS-SDK spans with no Benzene topic - those must not appear.
    const segment = `{
      "id": "5555666677778888",
      "name": "orders-api",
      "start_time": 1500000000.0,
      "end_time": 1500000001.0,
      "annotations": { "benzene_topic": "orders:get-all", "benzene_status": "ok" },
      "subsegments": [
        {
          "id": "9999aaaabbbbcccc",
          "name": "DynamoDB",
          "start_time": 1500000000.1,
          "end_time": 1500000000.2,
          "namespace": "aws"
        }
      ]
    }`;

    const source = new XRayTraceSource(new XRayStub(batchOneTrace(segment)).client);

    const view = await source.getTraceAsync(TraceId);

    expect(view).toBeDefined();
    expect(view!.events).toHaveLength(1); // only the topic-bearing span, not the DynamoDB subsegment
    expect(view!.events[0].topic).toBe('orders:get-all');
  });

  it('getTraceAsync returns undefined for an unknown trace (UnprocessedTraceIds, no segments)', async () => {
    const stub = new XRayStub(() => ({ Traces: [], UnprocessedTraceIds: [TraceId] }));
    const source = new XRayTraceSource(stub.client);

    expect(await source.getTraceAsync(TraceId)).toBeUndefined();
  });

  it('getTraceAsync returns undefined for a real trace that carried no Benzene spans', async () => {
    const segment =
      '{ "id": "deadbeefdeadbeef", "name": "some-other-service", "start_time": 1500000000.0, "end_time": 1500000001.0 }';
    const source = new XRayTraceSource(new XRayStub(batchOneTrace(segment)).client);

    expect(await source.getTraceAsync(TraceId)).toBeUndefined();
  });

  it('getTraceAsync returns undefined for an empty trace id', async () => {
    const source = new XRayTraceSource(new XRayStub().client);
    expect(await source.getTraceAsync('')).toBeUndefined();
  });

  it('getCorrelationAsync finds matching traces grouped by trace, earliest-first', async () => {
    // Two distinct traces both carrying the same business correlation id (ticket-42) - a correlation id can
    // span more than one flow, so each comes back as its own TraceView.
    const correlationId = 'ticket-42';
    const traceA = '1-aaaaaaaa-1111';
    const traceB = '1-bbbbbbbb-2222';

    const stub = new XRayStub(
      (input) => ({
        Traces: (input.TraceIds ?? []).map((id) => ({
          Id: id,
          Segments: [
            {
              Document:
                id === traceA
                  ? corrSegment('seg-a', 'orders-api', 'orders:create', correlationId, 1500000000.0)
                  : corrSegment('seg-b', 'billing-api', 'billing:charge', correlationId, 1500000100.0),
            },
          ],
        })),
      }),
      (input) => {
        // The search filters on the correlation-id annotation over a time window.
        expect(input.FilterExpression).toContain('annotation.benzene_correlation_id');
        expect(input.FilterExpression).toContain(correlationId);
        return {
          TraceSummaries: [
            { Id: traceB }, // later trace returned first...
            { Id: traceA },
          ],
        };
      },
    );

    const view = await new XRayTraceSource(stub.client).getCorrelationAsync(correlationId);

    expect(view).toBeDefined();
    expect(view!.correlationId).toBe(correlationId);
    expect(view!.traces).toHaveLength(2);
    // Ordered earliest-first regardless of the order X-Ray returned the summaries.
    expect(view!.traces[0].traceId).toBe(traceA);
    expect(view!.traces[0].events[0].topic).toBe('orders:create');
    expect(view!.traces[1].traceId).toBe(traceB);
    expect(view!.traces[1].events[0].topic).toBe('billing:charge');
  });

  it('getCorrelationAsync pages through all summaries following NextToken', async () => {
    const correlationId = 'ticket-99';
    let call = 0;
    const stub = new XRayStub(
      (input) => ({
        Traces: (input.TraceIds ?? []).map((id, i) => ({
          Id: id,
          Segments: [{ Document: corrSegment(`seg-${i}`, 'svc', 'topic:do', correlationId, 1500000000.0 + i) }],
        })),
      }),
      () => {
        // First page returns a NextToken; the source must follow it to collect page two.
        call++;
        return call === 1
          ? { TraceSummaries: [{ Id: '1-page1-0001' }], NextToken: 'more' }
          : { TraceSummaries: [{ Id: '1-page2-0002' }] };
      },
    );

    const view = await new XRayTraceSource(stub.client).getCorrelationAsync(correlationId);

    expect(view).toBeDefined();
    expect(view!.traces).toHaveLength(2); // both pages' traces collected
    expect(call).toBe(2); // followed the NextToken
  });

  it('getCorrelationAsync returns undefined when nothing matches', async () => {
    const stub = new XRayStub(undefined, () => ({ TraceSummaries: [] }));
    const source = new XRayTraceSource(stub.client);

    expect(await source.getCorrelationAsync('nobody')).toBeUndefined();
  });

  it('getCorrelationAsync returns undefined for an empty correlation id', async () => {
    const source = new XRayTraceSource(new XRayStub().client);
    expect(await source.getCorrelationAsync('')).toBeUndefined();
  });

  it('getRecentFlowsAsync enriches services from benzene.service, not X-Ray ServiceIds', async () => {
    // The X-Ray summary's ServiceIds carry the infra/handler names; enrichment fetches the trace and reads
    // benzene.service instead, so the row shows the real name.
    const trace = '1-5c000000-aaaaaaaaaaaaaaaaaaaaaaaa';
    const stub = new XRayStub(
      () => ({
        Traces: [
          {
            Id: trace,
            Segments: [{ Document: flowSegment('benzene-mesh', 'benzene:mesh:aggregate', 1600000000.5, 1600000000.75) }],
          },
        ],
      }),
      (input) => {
        expect(input.FilterExpression).toBeUndefined(); // recent flows is unfiltered
        return {
          TraceSummaries: [
            {
              Id: trace,
              Duration: 0.25,
              HasError: true,
              HasFault: false,
              // The infra name X-Ray reports — must NOT be what the row shows.
              ServiceIds: [{ Name: 'EventBridgeEventHandler' }],
            },
          ],
        };
      },
    );

    const flows = await new XRayTraceSource(stub.client).getRecentFlowsAsync(20);

    expect(flows).toHaveLength(1);
    const flow = flows[0];
    expect(flow.services).toEqual(['benzene-mesh']); // benzene.service, not "EventBridgeEventHandler"
    expect(flow.events).toBe(1); // real span count, not the old hardcoded 0
    expect(flow.failed).toBe(true); // summary's HasError flag is kept
    expect(flow.durationMs).toBeCloseTo(250, 3); // summary duration (seconds → ms)
    expect(flow.topic).toBe('benzene:mesh:aggregate'); // entry topic from the earliest mapped event
  });

  it('getRecentFlowsAsync orders by real start within the same epoch second', async () => {
    // Both trace ids share the SAME epoch prefix (second granularity), so the id-epoch key alone can't order
    // them. Enrichment reads each trace's real millisecond start, so the later-starting flow sorts first.
    const a = '1-5c000000-aaaaaaaaaaaaaaaaaaaaaaaa';
    const b = '1-5c000000-bbbbbbbbbbbbbbbbbbbbbbbb';
    const stub = new XRayStub(
      () => ({
        Traces: [
          // a starts at .200, b starts at .800 within the same second — b is newer.
          { Id: a, Segments: [{ Document: flowSegment('orders-api', 'orders:create', 1600000000.2, 1600000000.3) }] },
          { Id: b, Segments: [{ Document: flowSegment('billing-api', 'billing:charge', 1600000000.8, 1600000000.9) }] },
        ],
      }),
      () => ({
        TraceSummaries: [
          { Id: a, Duration: 0.1 },
          { Id: b, Duration: 0.1 },
        ],
      }),
    );

    const flows = await new XRayTraceSource(stub.client).getRecentFlowsAsync(20);

    expect(flows.map((f) => f.traceId)).toEqual([b, a]); // later real start first
  });

  it('getRecentFlowsAsync falls back to the summary plane per-row when enrichment fails', async () => {
    // One trace maps to a Benzene span (enriched); the other isn't returned by BatchGetTraces at all — that
    // row degrades to the summary plane (ServiceIds name, events = 0), it doesn't vanish or blank the list.
    const enriched = '1-5c000000-aaaaaaaaaaaaaaaaaaaaaaaa';
    const missing = '1-5b000000-bbbbbbbbbbbbbbbbbbbbbbbb';
    const stub = new XRayStub(
      () => ({
        // Only the enriched trace comes back; the missing one is absent (UnprocessedTraceIds in X-Ray).
        Traces: [
          {
            Id: enriched,
            Segments: [{ Document: flowSegment('benzene-mesh', 'benzene:mesh:aggregate', 1600000000.5, 1600000000.6) }],
          },
        ],
      }),
      () => ({
        TraceSummaries: [
          { Id: enriched, Duration: 0.1 },
          { Id: missing, Duration: 0.2, ServiceIds: [{ Name: 'orders-api' }] },
        ],
      }),
    );

    const flows = await new XRayTraceSource(stub.client).getRecentFlowsAsync(20);

    expect(flows).toHaveLength(2);
    expect(flows[0].traceId).toBe(enriched); // newer, enriched
    expect(flows[0].services).toEqual(['benzene-mesh']);
    expect(flows[0].events).toBe(1);
    expect(flows[1].traceId).toBe(missing); // older, summary-plane fallback
    expect(flows[1].services).toEqual(['orders-api']); // ServiceIds name
    expect(flows[1].events).toBe(0); // no span count on the summary plane
    expect(flows[1].topic).toBeUndefined(); // no Benzene span mapped → no topic attribution
  });

  it('getRecentFlowsAsync with enrichment off reproduces the summary plane without fetching traces', async () => {
    // With enrichment disabled (recentFlowsServiceEnrichmentMax = 0): ServiceIds names, id-epoch ordering,
    // events = 0, and zero BatchGetTraces calls.
    const older = '1-5b000000-aaaaaaaaaaaaaaaaaaaaaaaa';
    const newer = '1-5c000000-bbbbbbbbbbbbbbbbbbbbbbbb';
    const stub = new XRayStub(undefined, () => ({
      TraceSummaries: [
        { Id: older, Duration: 0.4, HasError: false, HasFault: false, ServiceIds: [{ Name: 'orders-api' }] },
        { Id: newer, Duration: 0.25, HasError: true, HasFault: false, ServiceIds: [{ Name: 'billing-api' }] },
      ],
    }));

    const options = new XRayTraceSourceOptions();
    options.recentFlowsServiceEnrichmentMax = 0;
    const source = new XRayTraceSource(stub.client, options);

    const flows = await source.getRecentFlowsAsync(20);

    expect(flows).toHaveLength(2);
    expect(flows[0].traceId).toBe(newer); // newest first (id epoch)
    expect(flows[0].failed).toBe(true);
    expect(flows[0].durationMs).toBeCloseTo(250, 3);
    expect(flows[0].services).toEqual(['billing-api']); // ServiceIds name, not enriched
    expect(flows[0].events).toBe(0);
    expect(flows[1].traceId).toBe(older);
    expect(stub.batchCalls).toBe(0); // never fetched a trace
  });

  it('getRecentFlowsAsync honours the limit', async () => {
    const stub = new XRayStub(undefined, () => ({
      TraceSummaries: Array.from({ length: 5 }, (_, i) => ({
        Id: `1-5b0000${String(i).padStart(2, '0')}-${String(i).padStart(24, '0')}`,
      })),
    }));
    // Enrichment off keeps this focused on the limit (no BatchGetTraces plumbing needed).
    const options = new XRayTraceSourceOptions();
    options.recentFlowsServiceEnrichmentMax = 0;
    const source = new XRayTraceSource(stub.client, options);

    const flows = await source.getRecentFlowsAsync(3);

    expect(flows).toHaveLength(3);
  });
});

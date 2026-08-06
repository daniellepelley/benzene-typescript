import { describe, expect, it } from 'vitest';
import { TempoFetch, TempoTraceSource, TempoTraceSourceOptions } from '@benzene/mesh-fleet-tempo';

/**
 * Port of test/Benzene.Mesh.Test/TempoTraceSourceTest.cs. The Tempo-backed trace source: trace-by-id
 * (`/api/traces/{id}`, OTLP/JSON) mapped to the mesh's waterfall, correlation + recent-flows via TraceQL
 * search (`/api/search`). Reads the Benzene span attributes verbatim (Tempo preserves keys), filters to
 * topic-bearing spans, and orders by start time - the non-AWS realisation of `IMeshTraceSource`, verified
 * against Tempo's documented API shapes.
 *
 * `HttpMessageHandler`/`HttpClient` -> a `fetch`-like router keyed by `request.RequestUri.PathAndQuery` (the
 * URL's `pathname + search`), so trace-by-id and search stub independently in one client. The C#
 * `evt.ExceptionType` assertion is preserved (the `exceptionType` field was added to `@benzene/mesh-wire`
 * with the X-Ray port).
 */

const TempoUrl = 'http://tempo:3200';

type Route = (path: string) => [number, string];

class Router {
  requests = 0;

  constructor(private readonly route: Route) {}

  readonly fetch: TempoFetch = (url) => {
    this.requests++;
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    const [status, body] = this.route(path);
    return Promise.resolve(new Response(body, { status }));
  };
}

function makeSource(route: Route): { source: TempoTraceSource; router: Router } {
  const router = new Router(route);
  return { source: new TempoTraceSource(router.fetch, new TempoTraceSourceOptions(TempoUrl)), router };
}

function traceBody(
  topic: string,
  status: string,
  service: string,
  correlationId = '',
  startNano = '1500000000000000000',
  endNano = '1500000000400000000',
): string {
  const correlationAttr =
    correlationId.length === 0
      ? ''
      : `, { "key": "benzene.correlation-id", "value": { "stringValue": "${correlationId}" } }`;
  return `
  {
    "batches": [
      {
        "resource": { "attributes": [ { "key": "service.name", "value": { "stringValue": "${service}" } } ] },
        "scopeSpans": [
          {
            "spans": [
              {
                "spanId": "aabbccdd", "parentSpanId": "",
                "startTimeUnixNano": "${startNano}",
                "endTimeUnixNano": "${endNano}",
                "attributes": [
                  { "key": "benzene.topic", "value": { "stringValue": "${topic}" } },
                  { "key": "benzene.version", "value": { "stringValue": "v1" } },
                  { "key": "benzene.status", "value": { "stringValue": "${status}" } },
                  { "key": "benzene.exception.type", "value": { "stringValue": "System.TimeoutException" } }${correlationAttr}
                ]
              },
              {
                "spanId": "eeff0011",
                "startTimeUnixNano": "1500000000100000000",
                "endTimeUnixNano": "1500000000150000000",
                "attributes": [ { "key": "http.method", "value": { "stringValue": "POST" } } ]
              }
            ]
          }
        ]
      }
    ]
  }`;
}

describe('TempoTraceSource', () => {
  it('getTraceAsync maps topic-bearing spans and skips non-Benzene spans', async () => {
    const { source } = makeSource(() => [200, traceBody('orders:create', 'ok', 'orders-api')]);

    const view = await source.getTraceAsync('trace-1');

    expect(view).toBeDefined();
    expect(view!.traceId).toBe('trace-1');
    expect(view!.events).toHaveLength(1); // only the topic-bearing span, not the http.method span
    const evt = view!.events[0];
    expect(evt.topic).toBe('orders:create');
    expect(evt.topicVersion).toBe('v1');
    expect(evt.status).toBe('ok');
    expect(evt.exceptionType).toBe('System.TimeoutException'); // the failure's WHY (spec §3), read when present
    expect(evt.service).toBe('orders-api');
    expect(evt.spanId).toBe('aabbccdd');
    expect(evt.parentSpanId).toBeUndefined(); // empty parentSpanId → undefined
    expect(evt.durationMs).toBe(400); // (end-start) nanos → ms
  });

  it('getTraceAsync prefers the benzene.service tag over the resource service name', async () => {
    // The pipeline's benzene.service is authoritative; the resource service.name (here an infra name) is
    // only the fallback — keeps the mesh's own namespace winning uniformly across the trace-plane mappers.
    const body = `
    { "batches": [ {
      "resource": { "attributes": [ { "key": "service.name", "value": { "stringValue": "aws-lambda" } } ] },
      "scopeSpans": [ { "spans": [ {
        "spanId": "aabbccdd", "startTimeUnixNano": "1500000000000000000", "endTimeUnixNano": "1500000000400000000",
        "attributes": [
          { "key": "benzene.topic", "value": { "stringValue": "orders:create" } },
          { "key": "benzene.service", "value": { "stringValue": "orders-api" } }
        ] } ] } ] } ] }`;
    const { source } = makeSource(() => [200, body]);

    const view = await source.getTraceAsync('trace-1');

    expect(view!.events).toHaveLength(1);
    expect(view!.events[0].service).toBe('orders-api'); // not "aws-lambda"
  });

  it('getTraceAsync returns undefined for an unknown trace', async () => {
    const { source } = makeSource(() => [404, '']);
    expect(await source.getTraceAsync('nope')).toBeUndefined();
  });

  it('getTraceAsync returns undefined for a trace without Benzene spans', async () => {
    const body =
      '{ "batches": [ { "resource": {}, "scopeSpans": [ { "spans": [ { "spanId": "x", "attributes": [ { "key": "db.system", "value": { "stringValue": "dynamodb" } } ] } ] } ] } ] }';
    const { source } = makeSource(() => [200, body]);
    expect(await source.getTraceAsync('t1')).toBeUndefined();
  });

  it('getCorrelationAsync searches by annotation, then fetches and groups by trace', async () => {
    const correlationId = 'ticket-42';
    const search =
      '{ "traces": [ { "traceID": "t-b", "startTimeUnixNano": "1500000100000000000" }, { "traceID": "t-a", "startTimeUnixNano": "1500000000000000000" } ] }';
    const { source } = makeSource((path) => {
      if (path.startsWith('/api/search')) {
        expect(decodeURIComponent(path)).toContain('benzene.correlation-id');
        expect(decodeURIComponent(path)).toContain(correlationId);
        return [200, search];
      }
      // Each fetched trace carries a distinct topic and start time so earliest-first is checkable
      // (t-a's span starts before t-b's, independent of the order search returned them).
      const isA = path.includes('t-a');
      return [
        200,
        traceBody(
          isA ? 'orders:create' : 'billing:charge',
          'ok',
          isA ? 'orders-api' : 'billing-api',
          correlationId,
          isA ? '1500000000000000000' : '1500000100000000000',
          isA ? '1500000000400000000' : '1500000100400000000',
        ),
      ];
    });

    const view = await source.getCorrelationAsync(correlationId);

    expect(view).toBeDefined();
    expect(view!.correlationId).toBe(correlationId);
    expect(view!.traces).toHaveLength(2);
    // Earliest-first by the trace's own events, regardless of search order.
    expect(view!.traces[0].traceId).toBe('t-a');
    expect(view!.traces[0].events[0].topic).toBe('orders:create');
    expect(view!.traces[1].traceId).toBe('t-b');
  });

  it('getCorrelationAsync returns undefined when nothing matches', async () => {
    const { source } = makeSource(() => [200, '{ "traces": [] }']);
    expect(await source.getCorrelationAsync('nobody')).toBeUndefined();
  });

  it('getRecentFlowsAsync maps search summaries, newest first', async () => {
    const search = `
    {
      "traces": [
        { "traceID": "old", "rootServiceName": "orders-api", "startTimeUnixNano": "1500000000000000000", "durationMs": 120 },
        { "traceID": "new", "rootServiceName": "billing-api", "startTimeUnixNano": "1500000100000000000", "durationMs": 55 }
      ]
    }`;
    const { source, router } = makeSource((path) => {
      expect(path.startsWith('/api/search')).toBe(true);
      expect(decodeURIComponent(path)).toContain('benzene.topic');
      return [200, search];
    });

    const flows = await source.getRecentFlowsAsync(20);

    expect(flows).toHaveLength(2);
    expect(flows[0].traceId).toBe('new'); // newest first
    expect(flows[0].durationMs).toBe(55);
    expect(flows[0].services).toEqual(['billing-api']);
    expect(flows[0].events).toBe(0);
    expect(flows[1].traceId).toBe('old');
    expect(router.requests).toBe(1); // recent flows is a single search, no per-row fetch
  });

  it('getRecentFlowsAsync honours the limit', async () => {
    const { source } = makeSource(() => [
      200,
      '{ "traces": [ { "traceID": "a", "startTimeUnixNano": "3" }, { "traceID": "b", "startTimeUnixNano": "2" }, { "traceID": "c", "startTimeUnixNano": "1" } ] }',
    ]);

    const flows = await source.getRecentFlowsAsync(2);

    expect(flows).toHaveLength(2);
  });
});

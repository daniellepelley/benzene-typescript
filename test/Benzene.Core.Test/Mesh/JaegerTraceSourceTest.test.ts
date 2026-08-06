import { describe, expect, it } from 'vitest';
import { JaegerFetch, JaegerTraceSource, JaegerTraceSourceOptions } from '@benzene/mesh-fleet-jaeger';

/**
 * Port of test/Benzene.Mesh.Test/JaegerTraceSourceTest.cs. The Jaeger-backed trace source: trace-by-id
 * (`/api/traces/{id}`) mapped from Jaeger's own model (microsecond times, `references` parentage,
 * `processes` service names), plus correlation and recent-flows via a per-service search fan-out
 * (`/api/traces?service=...`), deduped by trace id. The second non-AWS `IMeshTraceSource`, verified against
 * Jaeger's documented API shapes.
 *
 * `HttpMessageHandler`/`HttpClient` -> a `fetch`-like router; `request.RequestUri.PathAndQuery` -> the URL's
 * `pathname + search`. The C# `evt.ExceptionType` assertion is preserved (the `exceptionType` field was added
 * to `@benzene/mesh-wire` with the X-Ray port).
 */

const JaegerUrl = 'http://jaeger:16686';
const TwoServices = ['orders-api', 'billing-api'];

type Route = (path: string) => [number, string];

class Router {
  serviceListCalls = 0;

  constructor(private readonly route: Route) {}

  readonly fetch: JaegerFetch = (url) => {
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    if (path.startsWith('/api/services')) {
      this.serviceListCalls++;
    }
    const [status, body] = this.route(path);
    return Promise.resolve(new Response(body, { status }));
  };
}

function makeSource(route: Route, services: string[] | undefined): { source: JaegerTraceSource; router: Router } {
  const router = new Router(route);
  const options = new JaegerTraceSourceOptions(JaegerUrl);
  if (services !== undefined) {
    options.services = services;
  }
  return { source: new JaegerTraceSource(router.fetch, options), router };
}

function tag(key: string, value: string): string {
  return `{ "key": "${key}", "type": "string", "value": "${value}" }`;
}

function trace(
  traceId: string,
  service: string,
  topic: string,
  status: string,
  correlationId = '',
  startMicros = 1500000000000000,
  parentSpanId = '',
): string {
  let tags =
    tag('benzene.topic', topic) +
    ', ' +
    tag('benzene.version', 'v1') +
    ', ' +
    tag('benzene.status', status) +
    ', ' +
    tag('benzene.exception.type', 'System.TimeoutException');
  if (correlationId.length > 0) {
    tags += ', ' + tag('benzene.correlation-id', correlationId);
  }
  const references = parentSpanId.length === 0 ? '[]' : `[ { "refType": "CHILD_OF", "spanID": "${parentSpanId}" } ]`;
  const benzeneSpan =
    `{ "spanID": "span-${traceId}", "processID": "p1", "references": ${references}` +
    `, "startTime": ${startMicros}, "duration": 400000, "tags": [ ${tags} ] }`;
  const otherSpan =
    `{ "spanID": "other", "processID": "p1", "startTime": ${startMicros + 100000}` +
    `, "duration": 50000, "tags": [ ${tag('http.method', 'POST')} ] }`;
  return (
    `{ "traceID": "${traceId}", "spans": [ ${benzeneSpan}, ${otherSpan}` +
    ` ], "processes": { "p1": { "serviceName": "${service}" } } }`
  );
}

function data(...traces: string[]): string {
  return `{ "data": [ ${traces.join(', ')} ] }`;
}

function serviceOf(path: string): string {
  const marker = 'service=';
  const i = path.indexOf(marker);
  if (i < 0) {
    return '';
  }
  const rest = path.substring(i + marker.length);
  const amp = rest.indexOf('&');
  return decodeURIComponent(amp < 0 ? rest : rest.substring(0, amp));
}

describe('JaegerTraceSource', () => {
  it('getTraceAsync maps Benzene spans from the Jaeger model', async () => {
    const { source } = makeSource(
      () => [200, data(trace('trace-1', 'orders-api', 'orders:create', 'ok', '', 1500000000000000, 'parent-1'))],
      TwoServices,
    );

    const view = await source.getTraceAsync('trace-1');

    expect(view).toBeDefined();
    expect(view!.traceId).toBe('trace-1');
    expect(view!.events).toHaveLength(1); // the benzene span only, not the http.method span
    const evt = view!.events[0];
    expect(evt.topic).toBe('orders:create');
    expect(evt.topicVersion).toBe('v1');
    expect(evt.status).toBe('ok');
    expect(evt.exceptionType).toBe('System.TimeoutException'); // the failure's WHY (spec §3), read when present
    expect(evt.service).toBe('orders-api'); // from processes[p1].serviceName
    expect(evt.spanId).toBe('span-trace-1');
    expect(evt.parentSpanId).toBe('parent-1'); // from the CHILD_OF reference
    expect(evt.durationMs).toBe(400); // 400000 µs → ms
  });

  it('getTraceAsync prefers the benzene.service tag over the process service name', async () => {
    // benzene.service on the span wins over Jaeger's processes[].serviceName (an infra name here) — the
    // mesh's own namespace stays authoritative and uniform across the trace-plane mappers.
    const tags = tag('benzene.topic', 'orders:create') + ', ' + tag('benzene.service', 'orders-api');
    const span =
      `{ "spanID": "s1", "processID": "p1", "references": [], "startTime": 1500000000000000, "duration": 400000, "tags": [ ${tags} ] }`;
    const traceJson = `{ "traceID": "trace-1", "spans": [ ${span} ], "processes": { "p1": { "serviceName": "aws-lambda" } } }`;
    const { source } = makeSource(() => [200, data(traceJson)], TwoServices);

    const view = await source.getTraceAsync('trace-1');

    expect(view!.events).toHaveLength(1);
    expect(view!.events[0].service).toBe('orders-api'); // not "aws-lambda"
  });

  it('getTraceAsync returns undefined for an unknown trace', async () => {
    const { source } = makeSource(() => [404, ''], TwoServices);
    expect(await source.getTraceAsync('nope')).toBeUndefined();
  });

  it('getCorrelationAsync fans out across services and dedupes by trace id', async () => {
    const correlationId = 'ticket-42';
    // t-a starts before t-b; billing-api's search also returns t-a (a cross-service trace) → dedupe.
    const { source } = makeSource((path) => {
      expect(decodeURIComponent(path)).toContain('benzene.correlation-id');
      switch (serviceOf(path)) {
        case 'orders-api':
          return [200, data(trace('t-a', 'orders-api', 'orders:create', 'ok', correlationId, 1500000000000000))];
        case 'billing-api':
          return [
            200,
            data(
              trace('t-b', 'billing-api', 'billing:charge', 'ok', correlationId, 1500000100000000),
              trace('t-a', 'orders-api', 'orders:create', 'ok', correlationId, 1500000000000000),
            ),
          ];
        default:
          return [200, data()];
      }
    }, TwoServices);

    const view = await source.getCorrelationAsync(correlationId);

    expect(view).toBeDefined();
    expect(view!.correlationId).toBe(correlationId);
    expect(view!.traces).toHaveLength(2); // t-a deduped despite appearing in both searches
    expect(view!.traces[0].traceId).toBe('t-a'); // earliest-first
    expect(view!.traces[1].traceId).toBe('t-b');
  });

  it('getCorrelationAsync returns undefined when nothing matches', async () => {
    const { source } = makeSource(() => [200, data()], TwoServices);
    expect(await source.getCorrelationAsync('nobody')).toBeUndefined();
  });

  it('getRecentFlowsAsync maps full traces with event count and failure, newest first', async () => {
    const { source } = makeSource((path) => {
      switch (serviceOf(path)) {
        case 'orders-api':
          return [200, data(trace('t-a', 'orders-api', 'orders:create', 'ok', '', 1500000000000000))];
        case 'billing-api':
          return [200, data(trace('t-b', 'billing-api', 'billing:charge', 'not-found', '', 1500000100000000))];
        default:
          return [200, data()];
      }
    }, TwoServices);

    const flows = await source.getRecentFlowsAsync(20);

    expect(flows).toHaveLength(2);
    expect(flows[0].traceId).toBe('t-b'); // newest first
    expect(flows[0].failed).toBe(true); // status not-found → not the success class
    expect(flows[0].events).toBe(1); // Jaeger returns full traces → real span count
    expect(flows[0].services).toEqual(['billing-api']);
    expect(flows[0].topic).toBe('billing:charge'); // the flow's entry topic (earliest event's)
    expect(flows[1].traceId).toBe('t-a');
    expect(flows[1].failed).toBe(false); // status ok
  });

  it('getRecentFlowsAsync discovers services when none are configured', async () => {
    const { source, router } = makeSource((path) => {
      if (path.startsWith('/api/services')) {
        return [200, '{ "data": [ "orders-api" ] }'];
      }
      return serviceOf(path) === 'orders-api'
        ? [200, data(trace('t-a', 'orders-api', 'orders:create', 'ok'))]
        : [200, data()];
    }, undefined);

    const flows = await source.getRecentFlowsAsync(20);

    expect(router.serviceListCalls).toBe(1); // discovery was used
    expect(flows).toHaveLength(1);
    expect(flows[0].traceId).toBe('t-a');
  });
});

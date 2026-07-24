import { describe, expect, it } from 'vitest';
import { TopologyEdgeSource } from '@benzene/mesh-contracts';
import { PrometheusQueryClient, TempoServiceGraphTopologyBuilder, TempoTopologyOptions } from '@benzene/mesh-tracing-tempo';

/**
 * Port of test/Benzene.Mesh.Test/TempoServiceGraphTopologyBuilderTest.cs. The C# `HttpMessageHandler` that
 * routes by the `query` param becomes a stub `fetch` parsing the query string; `DateTimeOffset` -> epoch ms.
 */
const PrometheusUrl = 'https://prometheus.example/api/v1/query';
const FixedClockMs = Date.UTC(2026, 6, 15, 0, 0, 0);

/** A stub `fetch` that answers by matching a metric-substring against the PromQL `query` param. */
function routingByMetricFetch(): { map(metricSubstring: string, body: string): ReturnType<typeof routingByMetricFetch>; fetchFn: typeof fetch } {
  const responsesByMetricSubstring = new Map<string, string>();
  const emptyVector = '{ "status": "success", "data": { "resultType": "vector", "result": [] } }';

  const fetchFn = ((url: string) => {
    const query = new URL(url).searchParams.get('query') ?? '';
    let body = emptyVector;
    for (const [substring, mapped] of responsesByMetricSubstring) {
      if (query.includes(substring)) {
        body = mapped;
        break;
      }
    }
    return Promise.resolve(new Response(body, { status: 200 }));
  }) as unknown as typeof fetch;

  const api = {
    map(metricSubstring: string, body: string) {
      responsesByMetricSubstring.set(metricSubstring, body);
      return api;
    },
    fetchFn,
  };
  return api;
}

function vectorResult(...samples: [string, string, number][]): string {
  const entries = samples.map(
    ([client, server, value]) => `{ "metric": { "client": "${client}", "server": "${server}" }, "value": [1700000000, "${value}"] }`,
  );
  return `{ "status": "success", "data": { "resultType": "vector", "result": [ ${entries.join(',')} ] } }`;
}

function createBuilder(handler: ReturnType<typeof routingByMetricFetch>): TempoServiceGraphTopologyBuilder {
  const client = new PrometheusQueryClient(handler.fetchFn);
  const options = new TempoTopologyOptions(PrometheusUrl);
  return new TempoServiceGraphTopologyBuilder(client, options, () => FixedClockMs);
}

describe('TempoServiceGraphTopologyBuilder', () => {
  it('BuildAsync_FullData_JoinsIntoSingleEdge', async () => {
    const handler = routingByMetricFetch()
      .map('traces_service_graph_request_total', vectorResult(['orders-api', 'payments-api', 10]))
      .map('traces_service_graph_request_failed_total', vectorResult(['orders-api', 'payments-api', 1]))
      // Prometheus applies the "* 1000" seconds->ms conversion server-side, so these are already ms.
      .map('0.50', vectorResult(['orders-api', 'payments-api', 20]))
      .map('0.95', vectorResult(['orders-api', 'payments-api', 80]))
      .map('0.99', vectorResult(['orders-api', 'payments-api', 150]));

    const topology = await createBuilder(handler).buildAsync();

    expect(topology.edges).toHaveLength(1);
    const edge = topology.edges[0]!;
    expect(edge.client).toBe('orders-api');
    expect(edge.server).toBe('payments-api');
    expect(edge.source).toBe(TopologyEdgeSource.tempo);
    expect(edge.requestsPerMinute).toBe(10);
    expect(edge.errorRate).toBeCloseTo(0.1, 5);
    expect(edge.p50LatencyMs).toBeCloseTo(20, 3);
    expect(edge.p95LatencyMs).toBeCloseTo(80, 3);
    expect(edge.p99LatencyMs).toBeCloseTo(150, 3);
    expect(topology.generatedAtUtc).toBe(FixedClockMs);
  });

  it('BuildAsync_RequestsButNoFailures_ErrorRateIsZeroNotUndefined', async () => {
    const handler = routingByMetricFetch().map('traces_service_graph_request_total', vectorResult(['orders-api', 'payments-api', 10]));

    const topology = await createBuilder(handler).buildAsync();

    expect(topology.edges).toHaveLength(1);
    const edge = topology.edges[0]!;
    expect(edge.errorRate).toBe(0);
    expect(edge.p50LatencyMs).toBeUndefined();
    expect(edge.p95LatencyMs).toBeUndefined();
    expect(edge.p99LatencyMs).toBeUndefined();
  });

  it('BuildAsync_NoDataAtAllForAnyMetric_NoEdges', async () => {
    const handler = routingByMetricFetch();

    const topology = await createBuilder(handler).buildAsync();

    expect(topology.edges).toHaveLength(0);
  });

  it('BuildAsync_MultipleEdges_AllPresent', async () => {
    const handler = routingByMetricFetch()
      .map('traces_service_graph_request_total', vectorResult(['orders-api', 'payments-api', 20], ['orders-api', 'shipping-api', 5]))
      .map('traces_service_graph_request_failed_total', vectorResult(['orders-api', 'shipping-api', 5]));

    const topology = await createBuilder(handler).buildAsync();

    expect(topology.edges).toHaveLength(2);
    const ordersToPayments = topology.edges.find((e) => e.server === 'payments-api')!;
    const ordersToShipping = topology.edges.find((e) => e.server === 'shipping-api')!;
    expect(ordersToPayments.requestsPerMinute).toBe(20);
    expect(ordersToPayments.errorRate).toBe(0);
    expect(ordersToShipping.requestsPerMinute).toBe(5);
    expect(ordersToShipping.errorRate).toBe(1.0);
  });

  it('BuildAsync_ZeroRequestsButFailedDataSomehow_DoesNotThrow_ErrorRateIsZero', async () => {
    const handler = routingByMetricFetch().map('traces_service_graph_request_failed_total', vectorResult(['orders-api', 'payments-api', 2]));

    const topology = await createBuilder(handler).buildAsync();

    expect(topology.edges).toHaveLength(1);
    const edge = topology.edges[0]!;
    expect(edge.requestsPerMinute).toBeUndefined();
    expect(edge.errorRate).toBe(0);
  });
});

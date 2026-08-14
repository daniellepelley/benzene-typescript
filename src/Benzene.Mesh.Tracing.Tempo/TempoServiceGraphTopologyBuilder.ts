/** Port of Benzene.Mesh.Tracing.Tempo.TempoServiceGraphTopologyBuilder. */
import { MeshTopology, TopologyEdge, TopologyEdgeSource } from '@benzenejs/mesh-contracts';
import { PrometheusQueryClient } from './PrometheusQueryClient';
import { PrometheusSample } from './PrometheusSample';
import { TempoTopologyOptions } from './TempoTopologyOptions';

const RequestTotalMetric = 'traces_service_graph_request_total';
const RequestFailedMetric = 'traces_service_graph_request_failed_total';
const ServerSecondsBucketMetric = 'traces_service_graph_request_server_seconds_bucket';

/**
 * Builds a `MeshTopology` from Grafana Tempo's metrics-generator service-graph metrics, queried via a
 * Prometheus-compatible endpoint.
 *
 * An edge only appears in the result if it has at least one matching timeseries in the queried window -
 * real Prometheus semantics: a client/server pair with no traffic in the window produces no timeseries at
 * all. `DateTimeOffset` clock -> `() => number` (epoch ms); `Dictionary<(client, server), double>` ->
 * `Map<pairKey, number>` (a collision-free JSON-encoded key, since a service name can contain any character).
 */
export class TempoServiceGraphTopologyBuilder {
  private readonly clock: () => number;

  /**
   * @param client The Prometheus query client to use.
   * @param options Where and over what window to query.
   * @param clock Supplies the current time (epoch ms); defaults to `Date.now`. Overridable for deterministic tests.
   */
  constructor(
    private readonly client: PrometheusQueryClient,
    private readonly options: TempoTopologyOptions,
    clock?: () => number,
  ) {
    this.clock = clock ?? (() => Date.now());
  }

  /** Queries Tempo's service-graph metrics and assembles the resulting edges. */
  async buildAsync(): Promise<MeshTopology> {
    const window = formatPromQlDuration(this.options.timeWindowMs);

    const requestsPerMinute = await this.queryPerMinuteAsync(RequestTotalMetric, window);
    const failedPerMinute = await this.queryPerMinuteAsync(RequestFailedMetric, window);
    const p50 = await this.queryLatencyMsAsync(0.5, window);
    const p95 = await this.queryLatencyMsAsync(0.95, window);
    const p99 = await this.queryLatencyMsAsync(0.99, window);

    const edgeKeys = new Set<string>();
    for (const map of [requestsPerMinute, failedPerMinute, p50, p95, p99]) {
      for (const key of map.keys()) {
        edgeKeys.add(key);
      }
    }

    const edges = [...edgeKeys].map((key) => {
      const [client, server] = JSON.parse(key) as [string, string];
      const requests = requestsPerMinute.get(key);
      const failed = failedPerMinute.get(key);

      return new TopologyEdge(
        client,
        server,
        TopologyEdgeSource.tempo,
        requests,
        computeErrorRate(requests, failed),
        p50.get(key),
        p95.get(key),
        p99.get(key),
      );
    });

    return new MeshTopology(this.clock(), edges);
  }

  private async queryPerMinuteAsync(metric: string, window: string): Promise<Map<string, number>> {
    const promQl = `sum by (client, server) (rate(${metric}[${window}])) * 60`;
    return toEdgeMap(await this.client.queryAsync(this.options.prometheusUrl, promQl));
  }

  private async queryLatencyMsAsync(quantile: number, window: string): Promise<Map<string, number>> {
    const promQl =
      `histogram_quantile(${quantile.toFixed(2)}, ` +
      `sum by (le, client, server) (rate(${ServerSecondsBucketMetric}[${window}]))) * 1000`;
    return toEdgeMap(await this.client.queryAsync(this.options.prometheusUrl, promQl));
  }
}

function computeErrorRate(requestsPerMinute: number | undefined, failedPerMinute: number | undefined): number | undefined {
  if (failedPerMinute === undefined) {
    return requestsPerMinute === undefined ? undefined : 0;
  }

  if (requestsPerMinute === undefined || requestsPerMinute === 0) {
    return 0;
  }

  return failedPerMinute / requestsPerMinute;
}

function toEdgeMap(samples: PrometheusSample[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const sample of samples) {
    const client = sample.labels['client'];
    const server = sample.labels['server'];
    if (client === undefined || server === undefined) {
      continue;
    }

    if (Number.isNaN(sample.value)) {
      continue;
    }

    map.set(JSON.stringify([client, server]), sample.value);
  }

  return map;
}

/** `TimeSpan` -> a PromQL duration literal (`5m`, `1h`, `30s`), mirroring C#'s hour/minute/second cascade. */
function formatPromQlDuration(windowMs: number): string {
  const totalHours = windowMs / 3_600_000;
  if (totalHours >= 1 && totalHours === Math.floor(totalHours)) {
    return `${Math.floor(totalHours)}h`;
  }

  const totalMinutes = windowMs / 60_000;
  if (totalMinutes === Math.floor(totalMinutes)) {
    return `${Math.floor(totalMinutes)}m`;
  }

  return `${Math.floor(windowMs / 1000)}s`;
}

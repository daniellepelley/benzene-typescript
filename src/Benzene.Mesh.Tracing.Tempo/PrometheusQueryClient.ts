/** Port of Benzene.Mesh.Tracing.Tempo.PrometheusQueryClient. */
import { PrometheusSample } from './PrometheusSample';

type JsonObject = Record<string, unknown>;

/** A `fetch`-like function - the port of C# `HttpClient` (`HttpClient` -> injectable `fetch`). */
export type PrometheusFetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * A minimal client for Prometheus's HTTP instant-query API (`GET /api/v1/query?query=...`) - the query
 * surface Tempo's metrics-generator remote-writes service-graph metrics to.
 *
 * `HttpClient.GetAsync` -> injectable `fetch` (the body is read regardless of status, like `GetAsync` +
 * `ReadAsStringAsync`, not `GetStringAsync`). Never throws for a reachable-but-unsuccessful response (an
 * HTTP error, a Prometheus `"status":"error"` body, or a malformed/unexpected body all surface as an empty
 * result); genuine connection-level failures (the `fetch` rejecting) still throw.
 */
export class PrometheusQueryClient {
  constructor(private readonly fetchFn: PrometheusFetch = fetch) {}

  /**
   * Runs an instant PromQL query and returns its result as a flat list of samples.
   * @returns The matched timeseries samples, or an empty list if the query failed or returned nothing.
   */
  async queryAsync(prometheusUrl: string, promQl: string): Promise<PrometheusSample[]> {
    const url = `${prometheusUrl}?query=${encodeURIComponent(promQl)}`;
    const response = await this.fetchFn(url);
    const body = await response.text();

    try {
      return parseVectorResult(body);
    } catch {
      // Syntactically invalid JSON, or valid JSON of an unexpected shape - the "malformed/unexpected body"
      // the contract promises to swallow as an empty result rather than fault the whole topology build.
      return [];
    }
  }
}

function parseVectorResult(body: string): PrometheusSample[] {
  const document: unknown = JSON.parse(body);

  if (!isObject(document) || document.status !== 'success') {
    return [];
  }

  const data = document.data;
  if (!isObject(data) || !isArray(data.result)) {
    return [];
  }

  const samples: PrometheusSample[] = [];
  for (const entry of data.result) {
    if (!isObject(entry) || !isObject(entry.metric) || !isArray(entry.value) || entry.value.length !== 2) {
      continue;
    }

    const labels: Record<string, string> = {};
    for (const [name, value] of Object.entries(entry.metric)) {
      labels[name] = typeof value === 'string' ? value : '';
    }

    const rawValue = entry.value[1];
    if (typeof rawValue !== 'string') {
      continue;
    }
    const value = Number.parseFloat(rawValue);
    if (Number.isNaN(value)) {
      continue;
    }

    samples.push(new PrometheusSample(labels, value));
  }

  return samples;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

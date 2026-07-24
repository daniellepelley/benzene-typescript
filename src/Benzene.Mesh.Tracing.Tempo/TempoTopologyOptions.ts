/** Port of Benzene.Mesh.Tracing.Tempo.TempoTopologyOptions. */

/** Default lookback window used in each PromQL `rate(...)` query: 5 minutes, in milliseconds. */
export const DefaultTimeWindowMs = 5 * 60 * 1000;

/**
 * Configures where and over what time window `TempoServiceGraphTopologyBuilder` queries Tempo's
 * service-graph metrics. `TimeSpan` -> millisecond `number`.
 */
export class TempoTopologyOptions {
  readonly timeWindowMs: number;

  /**
   * @param prometheusUrl The Prometheus-compatible instant-query endpoint Tempo's metrics-generator
   * remote-writes to (e.g. `http://prometheus:9090/api/v1/query`).
   * @param timeWindowMs The lookback window used in each PromQL `rate(...)` query (ms). Defaults to 5 minutes.
   * Longer windows smooth over gaps but react more slowly to real traffic changes.
   */
  constructor(
    readonly prometheusUrl: string,
    timeWindowMs: number = DefaultTimeWindowMs,
  ) {
    this.timeWindowMs = timeWindowMs;
  }
}

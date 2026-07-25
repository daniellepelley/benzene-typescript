/** Port of Benzene.Mesh.Usage.ApplicationInsights.ApplicationInsightsUsageOptions. */

/** Default lookback window: 24 hours, in milliseconds. */
export const DefaultTimeWindowMs = 24 * 60 * 60 * 1000;

/** Default counter metric name. */
export const DefaultMetricName = 'benzene.messages.processed';

/**
 * Configures which Application Insights / Log Analytics workspace `ApplicationInsightsUsageSource` queries,
 * which metric, and over what window, to build the mesh usage feed. The defaults match the
 * `benzene.messages.processed` counter (tags `topic`/`transport`/`result`) as exported to Azure Monitor.
 * `TimeSpan` -> millisecond `number`; the three `{ get; set; }` dimension properties -> mutable fields.
 */
export class ApplicationInsightsUsageOptions {
  readonly timeWindowMs: number;
  readonly metricName: string;

  /** The `customDimensions` key carrying the topic id. Defaults to `"topic"`. */
  topicDimension = 'topic';

  /** The `customDimensions` key carrying the transport name. Defaults to `"transport"`. */
  transportDimension = 'transport';

  /** The `customDimensions` key carrying the result/outcome class. Defaults to `"result"`. */
  resultDimension = 'result';

  /**
   * @param workspaceId The Log Analytics workspace id (GUID) backing the Application Insights resource - the
   * `customerId`/workspace id, not the App Insights instrumentation key.
   * @param timeWindowMs The lookback window the counts cover (ms), and the window surfaced on the Mesh UI.
   * Defaults to 24 hours.
   * @param metricName The counter's metric name. Defaults to `"benzene.messages.processed"`.
   */
  constructor(
    readonly workspaceId: string,
    timeWindowMs: number = DefaultTimeWindowMs,
    metricName: string = DefaultMetricName,
  ) {
    this.timeWindowMs = timeWindowMs;
    this.metricName = metricName;
  }
}

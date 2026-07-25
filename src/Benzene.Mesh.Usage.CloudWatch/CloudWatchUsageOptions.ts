/** Port of Benzene.Mesh.Usage.CloudWatch.CloudWatchUsageOptions. */

/** Default lookback window: 24 hours, in milliseconds. */
export const DefaultTimeWindowMs = 24 * 60 * 60 * 1000;

/** Default CloudWatch namespace the counter is exported to. */
export const DefaultNamespace = 'Benzene/Mesh';

/** Default counter metric name. */
export const DefaultMetricName = 'benzene.messages.processed';

/**
 * Configures which CloudWatch metric `CloudWatchUsageSource` reads, and over what window, to build the mesh
 * usage feed. The defaults match the `benzene.messages.processed` counter (tags `topic`/`transport`/`result`)
 * as exported to CloudWatch by the ADOT collector's EMF exporter. `TimeSpan` -> millisecond `number`; the
 * settable dimension/period properties -> mutable fields.
 */
export class CloudWatchUsageOptions {
  readonly namespace: string;
  readonly metricName: string;
  readonly timeWindowMs: number;

  /** The metric dimension carrying the topic id. Defaults to `"topic"`. */
  topicDimension = 'topic';

  /** The metric dimension carrying the transport name. Defaults to `"transport"`. */
  transportDimension = 'transport';

  /** The metric dimension carrying the result/outcome class. Defaults to `"result"`. */
  resultDimension = 'result';

  /**
   * The bucket period, in seconds, each `Sum` query uses; the source sums every bucket in the window, so
   * this only affects resolution/cost, not the total. Defaults to 60. Must be a positive multiple of 60.
   */
  periodSeconds = 60;

  /**
   * @param namespace The CloudWatch namespace the counter was exported to. Defaults to `"Benzene/Mesh"`.
   * @param timeWindowMs The lookback window the counts cover (ms). Defaults to 24 hours.
   * @param metricName The counter's metric name. Defaults to `"benzene.messages.processed"`.
   */
  constructor(
    namespace: string = DefaultNamespace,
    timeWindowMs: number = DefaultTimeWindowMs,
    metricName: string = DefaultMetricName,
  ) {
    this.namespace = namespace;
    this.timeWindowMs = timeWindowMs;
    this.metricName = metricName;
  }
}

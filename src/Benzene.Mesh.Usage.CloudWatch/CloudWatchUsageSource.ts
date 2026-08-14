/** Port of Benzene.Mesh.Usage.CloudWatch.CloudWatchUsageSource. */
import {
  CloudWatchClient,
  Dimension,
  GetMetricDataCommand,
  ListMetricsCommand,
  Metric,
  MetricDataQuery,
  MetricDataResult,
} from '@aws-sdk/client-cloudwatch';
import { IMeshUsageSource, MeshUsage, MeshUsageEntry, MeshUsageSource } from '@benzenejs/mesh-contracts';
import { CloudWatchUsageOptions } from './CloudWatchUsageOptions';

// CloudWatch caps GetMetricData at 500 queries per call.
const MaxQueriesPerCall = 500;

/**
 * An `IMeshUsageSource` that reads the `benzene.messages.processed` counter back from CloudWatch and reports
 * it as the mesh usage feed: a count per (topic, transport, status) over a configured window. The counter is
 * exported to CloudWatch by the ADOT collector's EMF exporter; this source is the aggregator-side reader.
 *
 * It reports the dimensions the metric carries (topic, transport, and the outcome as `status`) and leaves
 * the ones it can't (`version`, `service`, `avgDurationMs`) `undefined`. It first lists the metric's live
 * dimension combinations (`ListMetrics`) and then sums each with one `GetMetricData` `Sum` query, so every
 * reported entry's dimensions are known exactly. An empty result is reported as an empty `MeshUsage.entries`
 * ("feed wired, no traffic observed"). `AWSSDK.CloudWatch`/`IAmazonCloudWatch` -> `@aws-sdk/client-cloudwatch`'s
 * `CloudWatchClient` + the v3 command pattern (the C# test mocked the SDK client, so the port takes it
 * directly rather than adding a seam); `DateTimeOffset`/`TimeSpan` -> epoch/ms `number`.
 */
export class CloudWatchUsageSource implements IMeshUsageSource {
  constructor(
    private readonly cloudWatch: CloudWatchClient,
    private readonly options: CloudWatchUsageOptions,
  ) {}

  async fetchUsageAsync(cancellationToken?: AbortSignal): Promise<MeshUsage | undefined> {
    const end = Date.now();
    const start = end - this.options.timeWindowMs;

    const metrics = await this.listMetricsAsync(cancellationToken);
    if (metrics.length === 0) {
      // The metric hasn't been seen at all - report an empty window rather than nothing, so the feed reads
      // as "wired, no traffic observed" instead of "no feed" (which an undefined return would mean).
      return new MeshUsage(end, start, end, []);
    }

    // One Sum query per live dimension combination; remember each id's dimensions to map the result back.
    const byId = new Map<string, Metric>();
    const queries: MetricDataQuery[] = [];
    let index = 0;
    for (const metric of metrics) {
      const id = 'm' + index++;
      byId.set(id, metric);
      queries.push({
        Id: id,
        ReturnData: true,
        MetricStat: {
          Metric: { Namespace: this.options.namespace, MetricName: this.options.metricName, Dimensions: metric.Dimensions },
          Period: this.options.periodSeconds,
          Stat: 'Sum',
        },
      });
    }

    const entries: MeshUsageEntry[] = [];
    for (const chunk of chunkList(queries, MaxQueriesPerCall)) {
      for (const result of await this.getMetricDataAsync(chunk, new Date(start), new Date(end), cancellationToken)) {
        const metric = result.Id !== undefined ? byId.get(result.Id) : undefined;
        if (metric === undefined) {
          continue;
        }

        // Sum every bucket in the window - the total request count at this dimension combination.
        const count = Math.round((result.Values ?? []).reduce((sum, value) => sum + value, 0));
        if (count <= 0) {
          // In ListMetrics (seen at some point) but no traffic in this window - not "used" now.
          continue;
        }

        const dimensions = toLookup(metric.Dimensions);
        const topic = dimensionValue(dimensions, this.options.topicDimension);
        if (topic === undefined || topic.length === 0) {
          // Not one of ours (no topic dimension) - never guess.
          continue;
        }

        entries.push(
          new MeshUsageEntry(
            topic,
            undefined,
            undefined,
            dimensionValue(dimensions, this.options.transportDimension),
            dimensionValue(dimensions, this.options.resultDimension),
            count,
            undefined,
            MeshUsageSource.cloudWatch,
          ),
        );
      }
    }

    return new MeshUsage(end, start, end, entries);
  }

  private async listMetricsAsync(cancellationToken?: AbortSignal): Promise<Metric[]> {
    const metrics: Metric[] = [];
    let nextToken: string | undefined;
    do {
      const response = await this.cloudWatch.send(
        new ListMetricsCommand({ Namespace: this.options.namespace, MetricName: this.options.metricName, NextToken: nextToken }),
        { abortSignal: cancellationToken },
      );
      if (response.Metrics !== undefined) {
        metrics.push(...response.Metrics);
      }
      nextToken = response.NextToken;
    } while (nextToken !== undefined && nextToken.length > 0);

    return metrics;
  }

  private async getMetricDataAsync(
    queries: MetricDataQuery[],
    startUtc: Date,
    endUtc: Date,
    cancellationToken?: AbortSignal,
  ): Promise<MetricDataResult[]> {
    const results: MetricDataResult[] = [];
    let nextToken: string | undefined;
    do {
      const response = await this.cloudWatch.send(
        new GetMetricDataCommand({ MetricDataQueries: queries, StartTime: startUtc, EndTime: endUtc, NextToken: nextToken }),
        { abortSignal: cancellationToken },
      );
      if (response.MetricDataResults !== undefined) {
        results.push(...response.MetricDataResults);
      }
      nextToken = response.NextToken;
    } while (nextToken !== undefined && nextToken.length > 0);

    return results;
  }
}

/** Case-insensitive lookup of a metric's dimensions (C#'s `OrdinalIgnoreCase` dictionary). */
function toLookup(dimensions: Dimension[] | undefined): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const dimension of dimensions ?? []) {
    if (dimension.Name !== undefined) {
      lookup.set(dimension.Name.toLowerCase(), dimension.Value ?? '');
    }
  }
  return lookup;
}

function dimensionValue(dimensions: Map<string, string>, name: string): string | undefined {
  return dimensions.get(name.toLowerCase());
}

function* chunkList<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}

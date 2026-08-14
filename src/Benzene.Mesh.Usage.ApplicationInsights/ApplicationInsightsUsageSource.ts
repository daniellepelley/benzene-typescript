/** Port of Benzene.Mesh.Usage.ApplicationInsights.ApplicationInsightsUsageSource. */
import { IMeshUsageSource, MeshUsage, MeshUsageEntry, MeshUsageSource } from '@benzenejs/mesh-contracts';
import { ApplicationInsightsUsageOptions } from './ApplicationInsightsUsageOptions';
import { IApplicationInsightsUsageQuery } from './IApplicationInsightsUsageQuery';

/**
 * An `IMeshUsageSource` that reads the `benzene.messages.processed` counter back from Azure Monitor /
 * Application Insights and reports it as the mesh usage feed: a count per (topic, transport, status) over a
 * configured window. The Azure sibling of the CloudWatch usage adapter.
 *
 * It reports the dimensions the metric carries (topic, transport, and the outcome as `status`) and leaves
 * the ones it can't (`version`, `service`, `avgDurationMs`) `undefined`, per the missing-dimension rule. An
 * empty result is reported as empty `MeshUsage.entries` ("feed wired, no traffic observed"), never
 * `undefined`; a genuine query failure propagates (the aggregator bounds and skips a throwing source).
 * `DateTimeOffset` -> epoch ms.
 */
export class ApplicationInsightsUsageSource implements IMeshUsageSource {
  constructor(
    private readonly query: IApplicationInsightsUsageQuery,
    private readonly options: ApplicationInsightsUsageOptions,
  ) {}

  async fetchUsageAsync(cancellationToken?: AbortSignal): Promise<MeshUsage | undefined> {
    const end = Date.now();
    const start = end - this.options.timeWindowMs;

    const rows = await this.query.queryAsync(this.options, this.options.timeWindowMs, cancellationToken);

    const entries: MeshUsageEntry[] = [];
    for (const row of rows) {
      if (row.topic === undefined || row.topic.length === 0 || row.count <= 0) {
        // Not one of ours (no topic) or not exercised in this window - never guess a row.
        continue;
      }

      entries.push(
        new MeshUsageEntry(
          row.topic,
          undefined,
          undefined,
          row.transport,
          row.result,
          row.count,
          undefined,
          MeshUsageSource.applicationInsights,
        ),
      );
    }

    return new MeshUsage(end, start, end, entries);
  }
}

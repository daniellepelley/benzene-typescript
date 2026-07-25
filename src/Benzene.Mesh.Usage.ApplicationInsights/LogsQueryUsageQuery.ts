/** Port of Benzene.Mesh.Usage.ApplicationInsights.LogsQueryUsageQuery. */
import { LogsQueryClient, LogsQueryResultStatus } from '@azure/monitor-query';
import { ApplicationInsightsUsageOptions } from './ApplicationInsightsUsageOptions';
import { IApplicationInsightsUsageQuery, UsageCount } from './IApplicationInsightsUsageQuery';

/**
 * The default `IApplicationInsightsUsageQuery`: issues a KQL query against a Log Analytics workspace (the
 * store behind a workspace-based Application Insights resource), summing the `customMetrics` counter by its
 * `customDimensions`. Returns one `UsageCount` per (topic, transport, result) combination over the window.
 *
 * `Azure.Monitor.Query` -> `@azure/monitor-query` (the JS-ecosystem equivalent); `QueryTimeRange(window)`
 * -> a `{ startTime, endTime }` interval computed from `windowMs`; a non-`Success` result throws (mirroring
 * `QueryWorkspaceAsync`'s throw-on-failure, which the usage source lets propagate so the aggregator skips it).
 */
export class LogsQueryUsageQuery implements IApplicationInsightsUsageQuery {
  constructor(private readonly client: LogsQueryClient) {}

  async queryAsync(
    options: ApplicationInsightsUsageOptions,
    windowMs: number,
    _cancellationToken?: AbortSignal,
  ): Promise<UsageCount[]> {
    // Sum the counter (customMetrics.valueSum is the per-interval sum; with delta temporality that is the
    // request delta, so a sum over the window is the total) grouped by the three tag dimensions. The
    // dimension keys are configurable; the result columns are fixed so parsing stays stable.
    const kql =
      `customMetrics\n` +
      `| where name == "${options.metricName}"\n` +
      `| extend _topic = tostring(customDimensions["${options.topicDimension}"]),\n` +
      `         _transport = tostring(customDimensions["${options.transportDimension}"]),\n` +
      `         _result = tostring(customDimensions["${options.resultDimension}"])\n` +
      `| summarize _count = sum(valueSum) by _topic, _transport, _result`;

    const end = new Date();
    const start = new Date(end.getTime() - windowMs);
    const result = await this.client.queryWorkspace(options.workspaceId, kql, { startTime: start, endTime: end });

    if (result.status !== LogsQueryResultStatus.Success) {
      throw new Error(`Application Insights logs query did not succeed (status: ${result.status}).`);
    }

    const table = result.tables[0];
    if (table === undefined) {
      return [];
    }

    const columnNames = table.columnDescriptors.map((column) => column.name);
    const cellByName = (row: readonly unknown[], name: string): unknown => {
      const index = columnNames.indexOf(name);
      return index >= 0 ? row[index] : undefined;
    };

    const rows: UsageCount[] = [];
    for (const row of table.rows) {
      const countCell = cellByName(row, '_count');
      const count = Math.round(typeof countCell === 'number' ? countCell : Number(countCell ?? 0));
      rows.push(
        new UsageCount(
          nullIfEmpty(asString(cellByName(row, '_topic'))),
          nullIfEmpty(asString(cellByName(row, '_transport'))),
          nullIfEmpty(asString(cellByName(row, '_result'))),
          count,
        ),
      );
    }

    return rows;
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

// KQL tostring of a missing customDimensions key yields an empty string; treat that as an absent dimension
// (undefined), never a real "" value - the same missing-dimension honesty the feed requires.
function nullIfEmpty(value: string): string | undefined {
  return value.length === 0 ? undefined : value;
}

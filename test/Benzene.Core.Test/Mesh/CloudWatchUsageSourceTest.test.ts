import { CloudWatchClient, GetMetricDataCommand, ListMetricsCommand, Metric } from '@aws-sdk/client-cloudwatch';
import { describe, expect, it } from 'vitest';
import { MeshUsageSource } from '@benzenejs/mesh-contracts';
import { CloudWatchUsageOptions, CloudWatchUsageSource } from '@benzenejs/mesh-usage-cloudwatch';

/**
 * Port of test/Benzene.Mesh.Test/CloudWatchUsageSourceTest.cs. The Moq `IAmazonCloudWatch` becomes a stub
 * `CloudWatchClient.send`: `ListMetricsCommand` returns the given metrics, `GetMetricDataCommand` returns,
 * per query, the datapoints `valuesFor` maps to that query's metric. `TimeSpan.FromHours(6)` -> 6h in ms.
 */
const SixHoursMs = 6 * 60 * 60 * 1000;

function metric(topic?: string, transport?: string, result?: string): Metric {
  const dimensions: { Name: string; Value: string }[] = [];
  if (topic !== undefined) dimensions.push({ Name: 'topic', Value: topic });
  if (transport !== undefined) dimensions.push({ Name: 'transport', Value: transport });
  if (result !== undefined) dimensions.push({ Name: 'result', Value: result });
  return { Namespace: 'Benzene/Mesh', MetricName: 'benzene.messages.processed', Dimensions: dimensions };
}

function cloudWatch(metrics: Metric[], valuesFor: (m: Metric) => number[]): CloudWatchClient {
  const send = (command: unknown): Promise<unknown> => {
    if (command instanceof ListMetricsCommand) {
      return Promise.resolve({ Metrics: metrics });
    }
    if (command instanceof GetMetricDataCommand) {
      const queries = command.input.MetricDataQueries ?? [];
      return Promise.resolve({ MetricDataResults: queries.map((q) => ({ Id: q.Id, Values: valuesFor(q.MetricStat!.Metric!) })) });
    }
    return Promise.reject(new Error('unexpected command'));
  };
  return { send } as unknown as CloudWatchClient;
}

function valuesFor(m: Metric): number[] {
  const topic = m.Dimensions?.find((d) => d.Name === 'topic')?.Value;
  const result = m.Dimensions?.find((d) => d.Name === 'result')?.Value;
  if (topic === 'orders:create' && result === 'success') return [10, 5]; // summed across buckets = 15
  if (topic === 'orders:create' && result === 'failure') return [2];
  return []; // orders:get success - in ListMetrics but no traffic this window
}

describe('CloudWatchUsageSource', () => {
  it('FetchUsageAsync_SumsEachDimensionCombination_OverTheWindow', async () => {
    const metrics = [metric('orders:create', 'sqs', 'success'), metric('orders:create', 'sqs', 'failure'), metric('orders:get', 'http', 'success')];
    const options = new CloudWatchUsageOptions(undefined, SixHoursMs);
    const source = new CloudWatchUsageSource(cloudWatch(metrics, valuesFor), options);

    const usage = await source.fetchUsageAsync();

    expect(usage).not.toBeUndefined();
    // The zero-traffic combination is dropped (in ListMetrics, but not used in this window).
    expect(usage!.entries).toHaveLength(2);

    const success = usage!.entries.find((e) => e.status === 'success')!;
    expect(success.topic).toBe('orders:create');
    expect(success.transport).toBe('sqs');
    expect(success.count).toBe(15);
    expect(success.source).toBe(MeshUsageSource.cloudWatch);
    // The counter carries none of these - reported absent, never guessed.
    expect(success.version).toBeUndefined();
    expect(success.service).toBeUndefined();
    expect(success.avgDurationMs).toBeUndefined();

    expect(usage!.entries.filter((e) => e.status === 'failure' && e.count === 2)).toHaveLength(1);

    expect(usage!.windowStartUtc).not.toBeUndefined();
    expect(usage!.windowEndUtc).not.toBeUndefined();
    expect(usage!.windowEndUtc! - usage!.windowStartUtc!).toBe(SixHoursMs);
  });

  it('FetchUsageAsync_NoMetrics_ReportsAWiredFeedWithNoEntries', async () => {
    // Never undefined: the metric simply hasn't been seen -> "feed wired, no traffic observed" (empty
    // entries), which the aggregator still publishes - distinct from no usage feed at all.
    const source = new CloudWatchUsageSource(cloudWatch([], () => []), new CloudWatchUsageOptions());

    const usage = await source.fetchUsageAsync();

    expect(usage).not.toBeUndefined();
    expect(usage!.entries).toHaveLength(0);
  });

  it('FetchUsageAsync_MetricWithoutATopicDimension_IsSkipped', async () => {
    // A stray metric in the namespace that isn't ours (no topic) is never guessed into an entry.
    const metrics = [metric(undefined, 'sqs', undefined)];
    const source = new CloudWatchUsageSource(cloudWatch(metrics, () => [99]), new CloudWatchUsageOptions());

    const usage = await source.fetchUsageAsync();

    expect(usage!.entries).toHaveLength(0);
  });
});

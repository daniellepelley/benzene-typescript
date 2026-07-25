import { describe, expect, it } from 'vitest';
import { MeshUsageSource } from '@benzene/mesh-contracts';
import {
  ApplicationInsightsUsageOptions,
  ApplicationInsightsUsageSource,
  IApplicationInsightsUsageQuery,
  UsageCount,
} from '@benzene/mesh-usage-application-insights';

/**
 * Port of test/Benzene.Mesh.Test/ApplicationInsightsUsageSourceTest.cs. Grouped (topic, transport, result)
 * counts from the backend become usage.json entries at exactly those dimensions - no version/service/
 * duration, zero-count and topic-less rows dropped, never a guessed count. The Moq query seam becomes a
 * hand-written stub; `TimeSpan.FromHours(6)` -> 6h in ms.
 */
const SixHoursMs = 6 * 60 * 60 * 1000;

function source(...rows: UsageCount[]): ApplicationInsightsUsageSource {
  const query: IApplicationInsightsUsageQuery = { queryAsync: () => Promise.resolve(rows) };
  return new ApplicationInsightsUsageSource(query, new ApplicationInsightsUsageOptions('ws-guid', SixHoursMs));
}

describe('ApplicationInsightsUsageSource', () => {
  it('FetchUsageAsync_MapsEachGroupedRow_ToAUsageEntry', async () => {
    const usage = await source(
      new UsageCount('orders:create', 'sqs', 'success', 15),
      new UsageCount('orders:create', 'sqs', 'failure', 2),
      new UsageCount('orders:get', 'http', 'success', 0), // in the table but no traffic -> dropped
    ).fetchUsageAsync();

    expect(usage).not.toBeUndefined();
    expect(usage!.entries).toHaveLength(2);

    const success = usage!.entries.find((e) => e.status === 'success')!;
    expect(success.topic).toBe('orders:create');
    expect(success.transport).toBe('sqs');
    expect(success.count).toBe(15);
    expect(success.source).toBe(MeshUsageSource.applicationInsights);
    expect(success.version).toBeUndefined();
    expect(success.service).toBeUndefined();
    expect(success.avgDurationMs).toBeUndefined();

    expect(usage!.entries.filter((e) => e.status === 'failure' && e.count === 2)).toHaveLength(1);

    expect(usage!.windowStartUtc).not.toBeUndefined();
    expect(usage!.windowEndUtc).not.toBeUndefined();
    expect(usage!.windowEndUtc! - usage!.windowStartUtc!).toBe(SixHoursMs);
  });

  it('FetchUsageAsync_NoRows_ReportsAWiredFeedWithNoEntries', async () => {
    const usage = await source().fetchUsageAsync();

    expect(usage).not.toBeUndefined();
    expect(usage!.entries).toHaveLength(0);
  });

  it('FetchUsageAsync_RowWithoutATopic_IsSkipped', async () => {
    // A grouped row whose topic dimension was absent (undefined) is never guessed into an entry.
    const usage = await source(new UsageCount(undefined, 'sqs', 'success', 99)).fetchUsageAsync();

    expect(usage!.entries).toHaveLength(0);
  });

  it('FetchUsageAsync_PreservesAbsentTransportAndStatus_AsUndefined', async () => {
    // The backend can group by a dimension it doesn't carry -> undefined; surfaced as absent, not "".
    const usage = await source(new UsageCount('orders:create', undefined, undefined, 4)).fetchUsageAsync();

    expect(usage!.entries).toHaveLength(1);
    const entry = usage!.entries[0]!;
    expect(entry.count).toBe(4);
    expect(entry.transport).toBeUndefined();
    expect(entry.status).toBeUndefined();
  });
});

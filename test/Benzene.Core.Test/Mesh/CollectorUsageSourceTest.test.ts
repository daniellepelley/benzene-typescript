import { describe, expect, it } from 'vitest';
import { CollectorUsageSource, MeshCollectorStore } from '@benzenejs/mesh-collector';
import { MeshUsageSource } from '@benzenejs/mesh-contracts';
import { MeshTraceEvent } from '@benzenejs/mesh-wire';

/**
 * Port of test/Benzene.Mesh.Test/CollectorUsageSourceTest.cs. The collector->aggregator usage bridge:
 * cumulative per-topic status counts become `usage.json` entries, at exactly the dimensions the trace feed
 * really has (no transport, no per-service attribution). `DateTimeOffset` -> epoch-ms `number`; the fixed
 * clock is a `() => number`; a null status/dimension -> `undefined`.
 */
function event(spanId: string, topic: string, status: string | undefined, version?: string): MeshTraceEvent {
  const evt = new MeshTraceEvent();
  evt.traceId = 'trace-1';
  evt.spanId = spanId;
  evt.service = 'orders-api';
  evt.topic = topic;
  evt.topicVersion = version;
  evt.status = status as string;
  evt.durationMs = 1;
  evt.startedAt = Date.now();
  return evt;
}

describe('CollectorUsageSource', () => {
  it('FetchUsageAsync_ReportsOneEntryPerTopicVersionStatus', async () => {
    const store = new MeshCollectorStore();
    store.addEvents([
      event('s1', 'orders:create', 'created', 'v1'),
      event('s2', 'orders:create', 'created', 'v1'),
      event('s3', 'orders:create', 'validation-error', 'v1'),
      event('s4', 'orders:get-all', 'ok'),
    ]);
    const at = Date.UTC(2026, 6, 22, 9, 0, 0); // 2026-07-22T09:00:00Z
    const source = new CollectorUsageSource(store, () => at);

    const usage = await source.fetchUsageAsync();

    expect(usage).toBeDefined();
    expect(usage!.generatedAtUtc).toBe(at);
    expect(usage!.windowStartUtc).toBe(store.startedAtUtc); // cumulative stats: window = since store start
    expect(usage!.windowEndUtc).toBe(at);
    expect(usage!.entries.length).toBe(3);

    const created = usage!.entries.filter((e) => e.status === 'created');
    expect(created.length).toBe(1);
    expect(created[0].topic).toBe('orders:create');
    expect(created[0].version).toBe('v1');
    expect(created[0].count).toBe(2);
    expect(created[0].source).toBe(MeshUsageSource.collector);
    // The trace wire shape carries neither dimension - reported as absent, never guessed.
    expect(created[0].transport).toBeUndefined();
    expect(created[0].service).toBeUndefined();

    expect(usage!.entries.filter((e) => e.status === 'validation-error' && e.count === 1).length).toBe(1);
    expect(
      usage!.entries.filter((e) => e.topic === 'orders:get-all' && e.status === 'ok' && e.version === undefined)
        .length,
    ).toBe(1);
  });

  it('FetchUsageAsync_EmptyStore_ReportsAWiredFeedWithNoEntries', async () => {
    // Never undefined: a live collector with no traffic is "feed wired, nothing observed" (empty entries),
    // which the aggregator still publishes - distinct from no usage feed at all.
    const source = new CollectorUsageSource(new MeshCollectorStore());

    const usage = await source.fetchUsageAsync();

    expect(usage).toBeDefined();
    expect(usage!.entries.length).toBe(0);
  });

  it('FetchUsageAsync_NullStatusTraffic_ReportsANullStatusEntry', async () => {
    // A null wire status is ingested as an empty-string count key; the usage entry surfaces it as a
    // genuinely absent status dimension rather than inventing a label.
    const store = new MeshCollectorStore();
    store.addEvents([event('s1', 'orders:create', undefined)]);
    const source = new CollectorUsageSource(store);

    const usage = await source.fetchUsageAsync();

    expect(usage!.entries.length).toBe(1);
    expect(usage!.entries[0].status).toBeUndefined();
    expect(usage!.entries[0].count).toBe(1);
  });
});

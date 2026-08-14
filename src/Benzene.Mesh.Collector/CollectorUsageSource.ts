/**
 * Port of Benzene.Mesh.Collector.CollectorUsageSource.
 *
 * Bridges a co-hosted collector's cumulative per-topic stats into the aggregator's usage feed
 * (`usage.json`) - the first shipped `IMeshUsageSource`. Register it alongside `addMeshAggregator` in a host
 * that also runs the collector's handlers (they share the singleton {@link MeshCollectorStore}).
 *
 * Reports one entry per (topic, version, status) from the store's cumulative status counts. The trace wire
 * shape carries no transport, and the store's per-status counts aren't attributed per handling service, so
 * `MeshUsageEntry.transport` and `MeshUsageEntry.service` are deliberately `undefined` rather than guessed -
 * a collector-fed usage feed exercises the consumer-side missing-dimension degradation path honestly.
 *
 * Divergences from the C# original: `Func<DateTimeOffset>` clock -> `() => number` (epoch ms), default
 * `Date.now`; `Task<MeshUsage?>` -> `Promise<MeshUsage | undefined>`. The C# `FetchUsageAsync` takes an
 * optional `MeshUsageWindow` (which it deliberately IGNORES, being cumulative-since-start) - this port omits
 * that parameter entirely because `@benzenejs/mesh-contracts`'s `IMeshUsageSource.fetchUsageAsync` has no
 * window parameter in this snapshot; behavior is identical (the window was ignored anyway).
 */
import { IMeshUsageSource, MeshUsage, MeshUsageEntry, MeshUsageSource } from '@benzenejs/mesh-contracts';
import { MeshCollectorStore } from './MeshCollectorStore';

export class CollectorUsageSource implements IMeshUsageSource {
  private readonly clock: () => number;

  /**
   * @param store The collector store to report from.
   * @param clock Supplies the current time (epoch ms); defaults to `Date.now`. Overridable for deterministic tests.
   */
  constructor(
    private readonly store: MeshCollectorStore,
    clock?: () => number,
  ) {
    this.clock = clock ?? (() => Date.now());
  }

  /**
   * Never returns `undefined`: a live collector with no traffic yet is a wired feed with nothing observed
   * (an empty entries array), not an absent one. The window always starts at the store's own start - the
   * in-memory stats are cumulative since process start, so a caller comparing the reported window to what it
   * asked for sees they differ and keeps `countsWindowed=false`.
   */
  fetchUsageAsync(): Promise<MeshUsage | undefined> {
    const entries = this.store
      .fleet()
      .topics.flatMap((topic) =>
        Object.entries(topic.statusCounts)
          .sort(([a], [b]) => ordinalCompare(a, b))
          .map(
            ([status, count]) =>
              new MeshUsageEntry(
                topic.topic,
                topic.version,
                undefined,
                undefined,
                status.length === 0 ? undefined : status,
                count,
                undefined,
                MeshUsageSource.collector,
              ),
          ),
      );

    return Promise.resolve(new MeshUsage(this.clock(), this.store.startedAtUtc, this.clock(), entries));
  }
}

function ordinalCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

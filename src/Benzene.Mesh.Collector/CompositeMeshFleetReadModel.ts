/**
 * Port of Benzene.Mesh.Collector.CompositeMeshFleetReadModel.
 *
 * An {@link IMeshFleetReadModel} composed from a pluggable {@link IMeshTraceSource} (X-Ray / Tempo / Jaeger)
 * for the trace-shaped read-models and one or more `IMeshUsageSource`s (CloudWatch / App Insights) for
 * per-topic stats - the backend-composed alternative to the in-memory push-collector.
 *
 * The two sources cover different, non-overlapping slices of the fleet, and each is fetched in isolation (a
 * throwing source degrades its own slice to empty, never blanks the whole view - the aggregator's
 * fetch-isolation rule): topics + stats come from the usage feed (no descriptor, and no duration for the
 * shipped adapters, so those dimensions are marked absent per topic row); recent flows and the
 * anonymous-but-live service list come from the trace source (name-only rows with their stat dimensions
 * marked absent). A single service's detail and a single topic's catalog row return `undefined` (no
 * descriptor feed on this plane).
 *
 * Divergences from the C# original:
 * - `MeshUsageWindow` is NOT threaded to the usage sources: `@benzene/mesh-contracts`'s
 *   `IMeshUsageSource.fetchUsageAsync` has no window parameter in this snapshot, so this port cannot ask a
 *   source to query its backend over the picked window. `countsWindowed` is still decided honestly from the
 *   windows each source *returns* on its `MeshUsage` (`windowStartUtc`/`windowEndUtc`) - a source that
 *   happens to return a matching window still reads as windowed; a cumulative source reads as not-windowed.
 * - The anonymous-service `missingFeeds` omits the `"issues"` marker (the `mesh:issues` feed is not ported).
 * - `DateTimeOffset` -> epoch-ms `number`; `IEnumerable<IMeshUsageSource>` -> `readonly IMeshUsageSource[]`.
 */
import { IMeshUsageSource, MeshUsage, MeshUsageEntry } from '@benzene/mesh-contracts';
import { IMeshFleetReadModel } from './IMeshFleetReadModel';
import { IMeshTraceSource } from './IMeshTraceSource';
import { MeshTimeRangeResolver, ResolvedWindow } from './MeshTimeRangeResolver';
import {
  CorrelationView,
  FleetView,
  MeshHealth,
  MeshTimeRange,
  MeshWindow,
  ServiceSummary,
  ServiceView,
  TopicSummary,
  TraceSummary,
  TraceView,
} from './Views';

/** Recent-flows cap, matching the push collector's MaxFleetTraces. */
const MaxFleetTraces = 20;

/**
 * How close a usage source's returned window must be to the requested one to count as "honored" - absorbs a
 * metrics backend snapping to its aggregation period, and the sub-second skew between the composite's `now`
 * and each source's. A cumulative source returns a window starting far earlier than this tolerance.
 */
const WindowMatchToleranceMs = 5 * 60 * 1000;

export class CompositeMeshFleetReadModel implements IMeshFleetReadModel {
  constructor(
    private readonly traceSource: IMeshTraceSource,
    private readonly usageSources: readonly IMeshUsageSource[],
  ) {}

  traceAsync(traceId: string, cancellationToken?: AbortSignal): Promise<TraceView | undefined> {
    return this.traceSource.getTraceAsync(traceId, cancellationToken);
  }

  correlationAsync(
    correlationId: string,
    range?: MeshTimeRange,
    cancellationToken?: AbortSignal,
  ): Promise<CorrelationView | undefined> {
    return this.traceSource.getCorrelationAsync(correlationId, range, cancellationToken);
  }

  // No descriptor feed on this plane, so neither a single service nor a single topic can be answered.
  serviceAsync(_name: string, _range?: MeshTimeRange, _cancellationToken?: AbortSignal): Promise<ServiceView | undefined> {
    return Promise.resolve(undefined);
  }

  topicAsync(
    _id: string,
    _version: string | undefined,
    _range?: MeshTimeRange,
    _cancellationToken?: AbortSignal,
  ): Promise<TopicSummary | undefined> {
    return Promise.resolve(undefined);
  }

  /**
   * Honors the `includeFlows` cost hint: with it false the trace source is not queried at all, so a
   * counts-only poll costs zero recent-flows scans. The topics/counts slice is unaffected.
   */
  async fleetAsync(
    range?: MeshTimeRange,
    includeFlows = true,
    cancellationToken?: AbortSignal,
  ): Promise<FleetView> {
    const requested = MeshTimeRangeResolver.resolve(range, Date.now());

    const { topics, reports } = await this.topicsFromUsage(cancellationToken);
    // Flows honor the picked window (the trace source takes the range). The counts honor it only on a usage
    // source whose returned window matches the request - compositeWindow decides that from what was returned.
    const flows = includeFlows ? await this.recentFlows(range, cancellationToken) : [];

    const view = new FleetView();
    view.generatedAt = Date.now();
    view.topics = topics;
    view.traces = flows;
    view.services = servicesFromFlows(flows);
    const window = compositeWindow(requested, reports);
    if (window !== undefined) {
      view.window = window;
    }
    return view;
  }

  /**
   * Merge every usage source's entries and roll them up into one {@link TopicSummary} per (topic, version).
   * A failing source contributes nothing (its slice degrades to empty). Also returns each source's report,
   * so the composite can decide from the returned windows whether the counts were actually windowed.
   */
  private async topicsFromUsage(
    cancellationToken?: AbortSignal,
  ): Promise<{ topics: TopicSummary[]; reports: MeshUsage[] }> {
    const entries: MeshUsageEntry[] = [];
    const reports: MeshUsage[] = [];
    for (const source of this.usageSources) {
      try {
        const usage = await source.fetchUsageAsync(cancellationToken);
        if (usage !== undefined) {
          reports.push(usage);
          if (usage.entries.length > 0) {
            entries.push(...usage.entries);
          }
        }
      } catch {
        // Fetch isolation: one bad usage source leaves the others' topics intact rather than failing the
        // whole fleet view.
      }
    }

    const groups = new Map<string, MeshUsageEntry[]>();
    for (const entry of entries) {
      const key = groupKey(entry.topic, entry.version ?? '');
      const list = groups.get(key);
      if (list === undefined) {
        groups.set(key, [entry]);
      } else {
        list.push(entry);
      }
    }

    const topics = [...groups.keys()]
      .sort(compareGroupKeys)
      .map((key) => topicSummaryFromUsage(parseGroupKey(key), groups.get(key)!));
    return { topics, reports };
  }

  private async recentFlows(
    range: MeshTimeRange | undefined,
    cancellationToken?: AbortSignal,
  ): Promise<TraceSummary[]> {
    try {
      const flows = await this.traceSource.getRecentFlowsAsync(MaxFleetTraces, range, cancellationToken);
      return [...flows];
    } catch {
      // Fetch isolation: a failing trace source degrades recent-flows (and the service list derived from it)
      // to empty rather than blanking the topics the usage feed supplied.
      return [];
    }
  }
}

/**
 * Build the reported {@link MeshWindow} for the composite plane. Flows always honor the picked window. The
 * counts honor it too when *every* contributing usage source returned a window matching the request - then
 * `countsWindowed` is true. If any source couldn't (a cumulative source returns its own wider window), the
 * counts are a union of differing windows, so `countsWindowed` is false and `countsSince` is the earliest
 * window the counts actually cover. `undefined` when no window was requested.
 */
function compositeWindow(requested: ResolvedWindow | undefined, reports: MeshUsage[]): MeshWindow | undefined {
  if (requested === undefined) {
    return undefined;
  }

  const { from, to } = requested;
  const honored =
    reports.length > 0 &&
    reports.every(
      (r) =>
        r.windowStartUtc !== undefined &&
        r.windowEndUtc !== undefined &&
        within(r.windowStartUtc, from) &&
        within(r.windowEndUtc, to),
    );

  const starts = reports.map((r) => r.windowStartUtc).filter((start): start is number => start !== undefined);
  const earliestStart = starts.length > 0 ? Math.min(...starts) : undefined;

  const window = new MeshWindow();
  window.from = MeshTimeRangeResolver.toIso(from);
  window.to = MeshTimeRangeResolver.toIso(to);
  window.countsWindowed = honored;
  window.countsSince =
    honored || earliestStart === undefined ? undefined : MeshTimeRangeResolver.toIso(earliestStart);
  return window;
}

function within(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= WindowMatchToleranceMs;
}

function topicSummaryFromUsage(key: { topic: string; version: string }, group: MeshUsageEntry[]): TopicSummary {
  const statusCounts: Record<string, number> = {};
  let invocations = 0;
  let errors = 0;
  let weightedDuration = 0;
  let durationSamples = 0;

  for (const entry of group) {
    invocations += entry.count;
    if (isErrorResult(entry.status)) {
      errors += entry.count;
    }
    // Keep the raw result token verbatim (success/exception/failure/not-found/...); a null result dimension
    // can't be a key, so it's counted but not itemized.
    if (entry.status !== undefined) {
      statusCounts[entry.status] = (statusCounts[entry.status] ?? 0) + entry.count;
    }
    if (entry.avgDurationMs !== undefined) {
      weightedDuration += entry.avgDurationMs * entry.count;
      durationSamples += entry.count;
    }
  }

  const summary = new TopicSummary();
  summary.topic = key.topic;
  summary.version = key.version.length === 0 ? undefined : key.version;
  summary.invocations = invocations;
  summary.errors = errors;
  summary.avgDurationMs = durationSamples > 0 ? weightedDuration / durationSamples : 0;
  summary.statusCounts = statusCounts;

  // Providers come from a descriptor feed this plane doesn't have; duration is absent unless a usage source
  // measured it. Mark both so the UI renders "—", not a fabricated zero.
  summary.missingFeeds.push('descriptor');
  if (durationSamples === 0) {
    summary.missingFeeds.push('duration');
  }

  return summary;
}

/**
 * Whether a usage entry's `result` tag counts as an error. This is the metric's published `result`
 * vocabulary (docs/mesh-usage-feed.md §1), NOT the wire-status vocabulary: `success` collapses every
 * ok/created/... outcome, `exception`/`failure` are error buckets with no specific status, and a verbatim
 * failure status (`not-found`/...) is itemized. So the rule is "anything that isn't success, &lt;missing&gt;,
 * or an absent dimension". Do NOT replace this with `BenzeneResultStatus.isFailure`/`!isSuccess` - they read
 * the wire vocabulary and would miscount `exception`/`failure` as non-errors and `success` as an error.
 */
function isErrorResult(status: string | undefined): boolean {
  return status !== undefined && status !== 'success' && status !== '<missing>';
}

/**
 * The distinct services observed across recent flows, each an anonymous-but-live row: known only from
 * traffic, so its per-service counts are genuinely absent and its health is unknown (no heartbeat feed).
 */
function servicesFromFlows(flows: readonly TraceSummary[]): ServiceSummary[] {
  const names = [...new Set(flows.flatMap((f) => f.services).filter((s) => s.length > 0))].sort(ordinalCompare);
  return names.map((name) => {
    const summary = new ServiceSummary();
    summary.service = name;
    summary.health = MeshHealth.unknown;
    summary.missingFeeds = ['descriptor', 'health', 'stats'];
    return summary;
  });
}

function groupKey(topic: string, version: string): string {
  return `${topic} ${version}`;
}

function parseGroupKey(key: string): { topic: string; version: string } {
  const sep = key.indexOf(' ');
  return { topic: key.substring(0, sep), version: key.substring(sep + 1) };
}

function compareGroupKeys(a: string, b: string): number {
  const ka = parseGroupKey(a);
  const kb = parseGroupKey(b);
  return ordinalCompare(ka.topic, kb.topic) || ordinalCompare(ka.version, kb.version);
}

function ordinalCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

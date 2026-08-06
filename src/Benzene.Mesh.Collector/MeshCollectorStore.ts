/**
 * Port of Benzene.Mesh.Collector.MeshCollectorStore.
 *
 * The in-memory state behind the spec collector (docs/specification/mesh.md §4-§6): cumulative per-service
 * and per-topic stats, the latest heartbeat per instance, registered descriptors, and a bounded ring of
 * recent trace events (the window consumer edges and the trace query derive from). Everything is derived - a
 * service that never registered still appears once its traces do (anonymous but live, with its missing feeds
 * named), a registered service with no traffic is a catalog entry with no stats, and no missing feed ever
 * fails ingestion or a query: the §6 degradation rule, collector side.
 *
 * Divergences from the C# original:
 * - The `mesh:issues` feed (`AddIssues`, `FleetView.Issues`, the per-service "issues" missing-feed marker)
 *   is NOT ported: its `MeshIssue`/`MeshIssueBatch`/`MeshTopics.Issues` prerequisites do not yet exist in
 *   `@benzene/mesh-wire`. The store is the pre-issues collector.
 * - `DateTimeOffset` -> epoch-millisecond `number`; `DateTimeOffset.UtcNow` -> `Date.now()`.
 * - The C# `lock (_lock)` around every mutation/read is dropped: JS is single-threaded, so no batch can be
 *   torn by a concurrent one (the §6 "snapshot copy" concern the lock guarded does not arise).
 * - The collector-local `BenzeneResultStatusExtensions.IsSuccess` (a duplicate of the six-status success
 *   set) is replaced by `BenzeneResultStatus.isSuccess` from `@benzene/results` - the identical set, already
 *   the cross-language success vocabulary.
 * - `StringComparer.Ordinal` ordering -> a local `ordinalCompare` (UTF-16 code-unit order, ordinal for the
 *   ASCII ids in play), the same helper `@benzene/mesh-aggregator` uses.
 */
import { MeshHeartbeat, MeshServiceDescriptor, MeshTraceEvent } from '@benzene/mesh-wire';
import { BenzeneResultStatus } from '@benzene/results';
import { IMeshFleetReadModel } from './IMeshFleetReadModel';
import { MeshTimeRangeResolver, ResolvedWindow } from './MeshTimeRangeResolver';
import {
  CorrelationView,
  FleetView,
  InstanceView,
  MeshHealth,
  MeshTimeRange,
  MeshWindow,
  ServiceSummary,
  ServiceView,
  TopicSummary,
  TraceSummary,
  TraceView,
} from './Views';

interface InstanceState {
  healthy: boolean;
  lastHeartbeat: number;
  descriptorHash?: string;
}

class ServiceState {
  descriptor?: MeshServiceDescriptor;
  readonly instances = new Map<string, InstanceState>();
  lastSeen = 0;
  invocations = 0;
  errors = 0;
}

class TopicState {
  readonly providers = new Set<string>();
  readonly statusCounts = new Map<string, number>();
  invocations = 0;
  errors = 0;
  totalDurationMs = 0;
  lastSeen = 0;
}

const MaxFleetTraces = 20;

export class MeshCollectorStore implements IMeshFleetReadModel {
  private readonly capacity: number;
  private readonly services = new Map<string, ServiceState>();
  private readonly topics = new Map<string, TopicState>();
  private readonly ring: MeshTraceEvent[] = [];
  private next = 0;

  /**
   * When this store started accumulating - the window start for anything reporting the cumulative stats
   * (storage is in-memory, so counts always cover "since process start"). Epoch milliseconds.
   */
  readonly startedAtUtc: number = Date.now();

  constructor(maxTraceEvents = 4096) {
    this.capacity = maxTraceEvents;
  }

  /**
   * Stores the descriptor as the service's current contract, replacing any previous registration wholesale
   * - a redeploy that drops a topic drops the provider claim with it.
   */
  register(descriptor: MeshServiceDescriptor): void {
    for (const topic of this.topics.values()) {
      topic.providers.delete(descriptor.service);
    }

    const state = this.ensureService(descriptor.service);
    state.descriptor = descriptor;
    state.lastSeen = Date.now();

    for (const topic of descriptor.topics) {
      this.ensureTopic(topicKey(topic.id, topic.version ?? '')).providers.add(descriptor.service);
    }
  }

  /** Records the latest health report for one instance. */
  heartbeat(heartbeat: MeshHeartbeat): void {
    const state = this.ensureService(heartbeat.service);
    state.lastSeen = Date.now();
    state.instances.set(heartbeat.instanceId ?? '', {
      healthy: heartbeat.health?.isHealthy ?? false,
      lastHeartbeat: Date.now(),
      descriptorHash: heartbeat.descriptorHash,
    });
  }

  /**
   * Ingests a trace batch: the bounded ring window plus cumulative stats (which deliberately outlive the
   * window). Returns how many events were accepted.
   */
  addEvents(events: readonly MeshTraceEvent[]): number {
    for (const traceEvent of events) {
      if (this.ring.length < this.capacity) {
        this.ring.push(traceEvent);
      } else {
        this.ring[this.next] = traceEvent;
        this.next = (this.next + 1) % this.capacity;
      }

      const failed = !BenzeneResultStatus.isSuccess(traceEvent.status);

      // A wire payload can carry a null/absent status; coalesce it so it never reaches a count key as
      // null-ish (against the §6 "no feed fails ingestion" rule).
      const status = traceEvent.status ?? '';
      const topic = this.ensureTopic(topicKey(traceEvent.topic, traceEvent.topicVersion ?? ''));
      topic.invocations++;
      topic.statusCounts.set(status, (topic.statusCounts.get(status) ?? 0) + 1);
      topic.totalDurationMs += traceEvent.durationMs;
      topic.lastSeen = Date.now();
      if (failed) {
        topic.errors++;
      }

      if (traceEvent.service !== undefined && traceEvent.service.length > 0) {
        const service = this.ensureService(traceEvent.service);
        service.invocations++;
        service.lastSeen = Date.now();
        if (failed) {
          service.errors++;
        }
      }
    }
    return events.length;
  }

  fleet(range?: MeshTimeRange): FleetView {
    const window = MeshTimeRangeResolver.resolve(range, Date.now());
    const consumers = this.consumersByTopic();
    const view = new FleetView();
    view.generatedAt = Date.now();
    view.services = [...this.services.keys()]
      .sort(ordinalCompare)
      .map((name) => this.serviceSummary(name));
    view.topics = [...this.topics.keys()]
      .sort(compareTopicKeys)
      .map((key) => this.topicSummary(key, consumers.get(key)));
    // Flows honor the window (ring filtered by trace start); the per-topic/service counts above are
    // cumulative-since-start and can't be sub-windowed - collectorWindow says so.
    view.traces = this.traceSummaries(MaxFleetTraces, window);
    const w = this.collectorWindow(window);
    if (w !== undefined) {
      view.window = w;
    }
    return view;
  }

  service(name: string, range?: MeshTimeRange): ServiceView | undefined {
    const state = this.services.get(name);
    if (state === undefined) {
      return undefined;
    }

    const summary = this.serviceSummary(name);
    const view = new ServiceView();
    view.service = summary.service;
    view.runtime = summary.runtime;
    view.binding = summary.binding;
    view.placement = summary.placement;
    view.topics = summary.topics;
    view.health = summary.health;
    view.lastSeen = summary.lastSeen;
    view.invocations = summary.invocations;
    view.errors = summary.errors;
    view.missingFeeds = summary.missingFeeds;
    view.descriptor = state.descriptor;
    view.instances = [...state.instances.entries()]
      .sort(([a], [b]) => ordinalCompare(a, b))
      .map(([instanceId, instance]) => {
        const instanceView = new InstanceView();
        instanceView.instanceId = instanceId;
        instanceView.healthy = instance.healthy;
        instanceView.lastHeartbeat = instance.lastHeartbeat;
        instanceView.descriptorHash = instance.descriptorHash;
        instanceView.hashMatches =
          state.descriptor?.descriptorHash !== undefined && instance.descriptorHash !== undefined
            ? instance.descriptorHash === state.descriptor.descriptorHash
            : undefined;
        return instanceView;
      });
    // The service's counts are cumulative-since-start; a requested window is reported (with
    // countsWindowed=false) so the page can badge them honestly.
    const w = this.collectorWindow(MeshTimeRangeResolver.resolve(range, Date.now()));
    if (w !== undefined) {
      view.window = w;
    }
    return view;
  }

  topic(id: string, version: string | undefined, range?: MeshTimeRange): TopicSummary | undefined {
    const key = topicKey(id, version ?? '');
    if (!this.topics.has(key)) {
      return undefined;
    }
    const summary = this.topicSummary(key, this.consumersByTopic().get(key));
    // Standalone topic response carries the window (cumulative counts on this plane); embedded in a
    // FleetView it stays undefined - the fleet's one window covers the whole view.
    const w = this.collectorWindow(MeshTimeRangeResolver.resolve(range, Date.now()));
    if (w !== undefined) {
      summary.window = w;
    }
    return summary;
  }

  trace(traceId: string): TraceView | undefined {
    const events = this.ring
      .filter((x) => x.traceId === traceId)
      .sort((a, b) => a.startedAt - b.startedAt);
    if (events.length === 0) {
      return undefined;
    }
    const view = new TraceView();
    view.traceId = traceId;
    view.events = events;
    return view;
  }

  /**
   * Every flow in the ring that carried `correlationId`, grouped by trace id - one {@link TraceView} per
   * trace (events in start order), traces ordered by earliest event. A correlation id is a business
   * identifier that can span multiple traces, so the result preserves that grouping rather than flattening.
   * Events with a null correlation id never match (the mesh never fabricates one). Returns `undefined` when
   * nothing carried it.
   */
  correlation(correlationId: string, range?: MeshTimeRange): CorrelationView | undefined {
    const window = MeshTimeRangeResolver.resolve(range, Date.now());
    const groups = new Map<string, MeshTraceEvent[]>();
    for (const event of this.ring) {
      if (event.correlationId !== correlationId) {
        continue;
      }
      const list = groups.get(event.traceId);
      if (list === undefined) {
        groups.set(event.traceId, [event]);
      } else {
        list.push(event);
      }
    }

    const traces = [...groups.entries()]
      .map(([traceId, events]) => {
        const view = new TraceView();
        view.traceId = traceId;
        view.events = [...events].sort((a, b) => a.startedAt - b.startedAt);
        return view;
      })
      // A flow is in-window when it started in [from,to] - the same trace-start rule the fleet recent-flows
      // list uses, so a window filters both consistently.
      .filter(
        (view) =>
          window === undefined ||
          (view.events[0].startedAt >= window.from && view.events[0].startedAt <= window.to),
      )
      .sort((a, b) => a.events[0].startedAt - b.events[0].startedAt);

    if (traces.length === 0) {
      return undefined;
    }
    const result = new CorrelationView();
    result.correlationId = correlationId;
    result.traces = traces;
    const w = this.collectorWindow(window);
    if (w !== undefined) {
      result.window = w;
    }
    return result;
  }

  /**
   * Build the reported {@link MeshWindow} for this (push-collector) plane: flows honor `window`, but counts
   * are cumulative since {@link startedAtUtc} - so {@link MeshWindow.countsWindowed} is false and
   * {@link MeshWindow.countsSince} names when the counts really cover from. `undefined` when no window was
   * requested (the field is then omitted - today's shape).
   */
  private collectorWindow(window: ResolvedWindow | undefined): MeshWindow | undefined {
    if (window === undefined) {
      return undefined;
    }
    const meshWindow = new MeshWindow();
    meshWindow.from = MeshTimeRangeResolver.toIso(window.from);
    meshWindow.to = MeshTimeRangeResolver.toIso(window.to);
    meshWindow.countsWindowed = false;
    meshWindow.countsSince = MeshTimeRangeResolver.toIso(this.startedAtUtc);
    return meshWindow;
  }

  // IMeshFleetReadModel - the in-memory store is synchronous, so these just wrap the read methods above (the
  // query handlers depend on the async interface so a backend-composed reader can slot in). `includeFlows`
  // is ignored: the store's in-memory ring flows are free, so a counts-only hint costs nothing to honor.
  fleetAsync(range?: MeshTimeRange): Promise<FleetView> {
    return Promise.resolve(this.fleet(range));
  }

  serviceAsync(name: string, range?: MeshTimeRange): Promise<ServiceView | undefined> {
    return Promise.resolve(this.service(name, range));
  }

  topicAsync(id: string, version: string | undefined, range?: MeshTimeRange): Promise<TopicSummary | undefined> {
    return Promise.resolve(this.topic(id, version, range));
  }

  traceAsync(traceId: string): Promise<TraceView | undefined> {
    return Promise.resolve(this.trace(traceId));
  }

  correlationAsync(correlationId: string, range?: MeshTimeRange): Promise<CorrelationView | undefined> {
    return Promise.resolve(this.correlation(correlationId, range));
  }

  private ensureService(name: string): ServiceState {
    let state = this.services.get(name);
    if (state === undefined) {
      state = new ServiceState();
      this.services.set(name, state);
    }
    return state;
  }

  private ensureTopic(key: string): TopicState {
    let state = this.topics.get(key);
    if (state === undefined) {
      state = new TopicState();
      this.topics.set(key, state);
    }
    return state;
  }

  /**
   * Derives who-calls-whom from the ring window: an event whose parent span belongs to another service
   * makes that service a consumer of the event's topic (spec §4). Unmeshed callers have no parent span in
   * the window and produce no edge - never a guess.
   */
  private consumersByTopic(): Map<string, Set<string>> {
    const spanService = new Map<string, string>();
    for (const traceEvent of this.ring) {
      if (traceEvent.service !== undefined && traceEvent.service.length > 0) {
        spanService.set(traceEvent.spanId, traceEvent.service);
      }
    }

    const consumers = new Map<string, Set<string>>();
    for (const traceEvent of this.ring) {
      if (traceEvent.parentSpanId === undefined || traceEvent.parentSpanId.length === 0) {
        continue;
      }
      const caller = spanService.get(traceEvent.parentSpanId);
      if (caller === undefined || caller === traceEvent.service) {
        continue;
      }
      const key = topicKey(traceEvent.topic, traceEvent.topicVersion ?? '');
      let set = consumers.get(key);
      if (set === undefined) {
        set = new Set<string>();
        consumers.set(key, set);
      }
      set.add(caller);
    }
    return consumers;
  }

  private serviceSummary(name: string): ServiceSummary {
    const state = this.services.get(name)!;
    const summary = new ServiceSummary();
    summary.service = name;
    summary.health = MeshHealth.unknown;
    summary.lastSeen = state.lastSeen;
    summary.instances = state.instances.size;
    summary.invocations = state.invocations;
    summary.errors = state.errors;

    if (state.descriptor !== undefined) {
      summary.runtime = state.descriptor.runtime;
      summary.binding = state.descriptor.binding;
      summary.placement = state.descriptor.placement;
      summary.topics = state.descriptor.topics.length;
    } else {
      summary.missingFeeds.push('descriptor'); // known only from traffic: anonymous but live
    }

    if (state.instances.size === 0) {
      summary.missingFeeds.push('health');
    } else {
      summary.health = [...state.instances.values()].every((x) => x.healthy)
        ? MeshHealth.healthy
        : MeshHealth.degraded;
    }

    if (state.invocations === 0) {
      summary.missingFeeds.push('traces');
    }
    return summary;
  }

  private topicSummary(key: string, consumers: Set<string> | undefined): TopicSummary {
    const state = this.topics.get(key)!;
    const { id, version } = parseTopicKey(key);
    const summary = new TopicSummary();
    summary.topic = id;
    summary.version = version.length === 0 ? undefined : version;
    summary.providers = [...state.providers].sort(ordinalCompare);
    summary.consumers = [...(consumers ?? new Set<string>())].sort(ordinalCompare);
    summary.invocations = state.invocations;
    summary.errors = state.errors;
    summary.avgDurationMs = state.invocations > 0 ? state.totalDurationMs / state.invocations : 0;
    summary.statusCounts = Object.fromEntries(state.statusCounts);
    summary.lastSeen = state.lastSeen;
    return summary;
  }

  private traceSummaries(limit: number, window?: ResolvedWindow): TraceSummary[] {
    const groups = new Map<string, MeshTraceEvent[]>();
    for (const event of this.ring) {
      const list = groups.get(event.traceId);
      if (list === undefined) {
        groups.set(event.traceId, [event]);
      } else {
        list.push(event);
      }
    }

    return [...groups.entries()]
      .map(([traceId, events]) => {
        const startedAt = Math.min(...events.map((x) => x.startedAt));
        const end = Math.max(...events.map((x) => x.startedAt + x.durationMs));
        const summary = new TraceSummary();
        summary.traceId = traceId;
        summary.events = events.length;
        summary.services = [
          ...new Set(events.filter((x) => x.service !== undefined && x.service.length > 0).map((x) => x.service!)),
        ].sort(ordinalCompare);
        summary.startedAt = startedAt;
        summary.durationMs = end - startedAt;
        summary.failed = events.some((x) => !BenzeneResultStatus.isSuccess(x.status));
        // The flow's entry topic: the earliest event's. Ring events always carry a topic.
        summary.topic = [...events]
          .sort((a, b) => a.startedAt - b.startedAt)
          .map((x) => x.topic)
          .find((t) => t !== undefined && t.length > 0);
        return summary;
      })
      // A flow is in-window when it started in [from,to]; no window => today's unfiltered last-N.
      .filter((t) => window === undefined || (t.startedAt >= window.from && t.startedAt <= window.to))
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }
}

// A topic is keyed by (id, version). The ring/dictionary key packs both into one string so it can key a
// JS Map (C#'s value-tuple dictionary key). The NUL (\u0000) separator can't appear in a topic id or version, so the key is collision-free.
function topicKey(id: string, version: string): string {
  return `${id}\u0000${version}`;
}

function parseTopicKey(key: string): { id: string; version: string } {
  const sep = key.indexOf('\u0000');
  return { id: key.substring(0, sep), version: key.substring(sep + 1) };
}

function compareTopicKeys(a: string, b: string): number {
  const ka = parseTopicKey(a);
  const kb = parseTopicKey(b);
  return ordinalCompare(ka.id, kb.id) || ordinalCompare(ka.version, kb.version);
}

function ordinalCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

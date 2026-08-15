/**
 * Port of Benzene.Mesh.Collector.MeshCollectorStore.
 *
 * The in-memory state behind the spec collector (docs/specification/mesh.md §4-§6): cumulative per-service
 * and per-topic stats, the latest heartbeat per instance, registered descriptors, and a bounded ring of
 * recent trace events (the window the trace/correlation queries derive from). Everything is derived - a
 * service that never registered still appears once its traces do (anonymous but live, with its missing feeds
 * named), a registered service with no traffic is a catalog entry with no stats, and no missing feed ever
 * fails ingestion or a query: the §6 degradation rule, collector side.
 *
 * **Declared vs. observed (the 2026-08 revision, mesh.md §4/§4.2):** the producer/consumer graph is now built
 * ENTIRELY from the latest registered `ServiceDescriptor` - `topics` gives provider edges, `consumes` gives
 * consumer edges (`register` replaces both wholesale) - never from trace parentage. Trace parentage is kept
 * only as a separate, additive, observed-only signal, layered on top of the declared graph and never fed back
 * into it: a `spanId -> service` index (`spanIdToService`, scoped to the same bounded ring window as the trace
 * queries) lets ingestion notice, per event, which service actually provided/called a topic, which feeds two
 * things that are NOT graph membership - (a) per-edge `lastObservedAt` (`providerObservedAt`/
 * `consumerObservedAt` on `TopicState`, surfaced as `TopicSummary.providerActivity`/`consumerActivity`), the
 * "Unobserved" decommission-candidate signal, and (b) a synthesized `contract-drift` issue (mesh.md §4.1's
 * classification, filed exactly like a wire-fed `mesh:issues` entry) when a *registered* service's traffic
 * names a topic it never declared providing/consuming - the "Undeclared" signal. An anonymous/never-registered
 * service is never flagged (no descriptor, no contract to diverge from).
 *
 * Divergences from the C# original:
 * - `DateTimeOffset` -> epoch-millisecond `number`; `DateTimeOffset.UtcNow` -> `Date.now()`.
 * - The C# `lock (_lock)` around every mutation/read is dropped: JS is single-threaded, so no batch can be
 *   torn by a concurrent one (the §6 "snapshot copy" concern the lock guarded does not arise).
 * - The collector-local `BenzeneResultStatusExtensions.IsSuccess` (a duplicate of the six-status success
 *   set) is replaced by `BenzeneResultStatus.isSuccess` from `@benzenejs/results` - the identical set, already
 *   the cross-language success vocabulary.
 * - `StringComparer.Ordinal` ordering -> a local `ordinalCompare` (UTF-16 code-unit order, ordinal for the
 *   ASCII ids in play), the same helper `@benzenejs/mesh-aggregator` uses.
 */
import {
  MeshHeartbeat,
  MeshIssue,
  MeshIssueBatch,
  MeshIssueClassification,
  MeshIssueFingerprint,
  MeshServiceDescriptor,
  MeshTopicDescriptor,
  MeshTraceEvent,
} from '@benzenejs/mesh-wire';
import { BenzeneResultStatus } from '@benzenejs/results';
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
  TopicActivity,
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
  // True once ANY mesh:issues batch (including an empty liveness batch) named this service - what lets "quiet
  // wired feed" be distinguished from "feed not wired" (spec §4.1).
  issueFeedSeen = false;
}

class TopicState {
  // Declared graph membership (mesh.md §4, the 2026-08 revision): providers from every registered
  // ServiceDescriptor's `topics`, consumers from its `consumes`. Populated/replaced wholesale by `register`
  // ONLY - trace parentage never admits or removes an entry here (spec §4.2's "not for graph membership").
  readonly providers = new Set<string>();
  readonly consumers = new Set<string>();
  // Observed-only liveness signal (§4.2 "Unobserved"): per-edge last-observed-at, epoch ms, keyed by the
  // provider/consumer service name. Cumulative since store start (like the stats below), NOT bounded by the
  // ring window - an edge doesn't need its exemplar trace retained to remember it was once exercised.
  readonly providerObservedAt = new Map<string, number>();
  readonly consumerObservedAt = new Map<string, number>();
  readonly statusCounts = new Map<string, number>();
  invocations = 0;
  errors = 0;
  totalDurationMs = 0;
  lastSeen = 0;
}

const MaxFleetTraces = 20;

export class MeshCollectorStore implements IMeshFleetReadModel {
  private readonly capacity: number;
  private readonly maxIssues: number;
  private readonly services = new Map<string, ServiceState>();
  private readonly topics = new Map<string, TopicState>();
  private readonly issues = new Map<string, MeshIssue>();
  private readonly ring: MeshTraceEvent[] = [];
  private next = 0;

  /**
   * `spanId -> service` index over exactly the ring's current window (kept in lockstep with every push/evict
   * below) - used ONLY for the §4.2 observed-only signals (per-edge `lastObservedAt` and undeclared-edge
   * `contract-drift`), NEVER for graph membership (spec §4: the declared graph comes from `register` alone).
   * A parent span that has already aged out of the window is indistinguishable from one that was never
   * meshed - the same "absence of evidence is not evidence of absence" posture the spec calls for.
   */
  private readonly spanIdToService = new Map<string, string>();

  /**
   * When this store started accumulating - the window start for anything reporting the cumulative stats
   * (storage is in-memory, so counts always cover "since process start"). Epoch milliseconds.
   */
  readonly startedAtUtc: number = Date.now();

  constructor(maxTraceEvents = 4096, maxIssues = 1024) {
    this.capacity = maxTraceEvents;
    this.maxIssues = maxIssues;
  }

  /**
   * Stores the descriptor as the service's current contract, replacing any previous registration wholesale
   * - a redeploy that drops a topic from `topics` drops the provider edge with it, and a redeploy that drops
   * a topic from `consumes` drops the consumer edge with it, the same rule applied symmetrically to both
   * declared lists (spec §4). This is the ONLY thing that ever changes the declared graph.
   */
  register(descriptor: MeshServiceDescriptor): void {
    for (const topic of this.topics.values()) {
      topic.providers.delete(descriptor.service);
      topic.consumers.delete(descriptor.service);
    }

    const state = this.ensureService(descriptor.service);
    state.descriptor = descriptor;
    state.lastSeen = Date.now();

    // A wire body is deserialized straight off parsed JSON (no class construction), so an omitted
    // `topics`/`consumes` - legal on the wire, e.g. a service that declares no outbound registration -
    // is genuinely `undefined` here, not the class field's `[]` default. Coalesce rather than assume,
    // against the §6 "no feed fails ingestion" rule.
    for (const topic of descriptor.topics ?? []) {
      this.ensureTopic(topicKey(topic.id, topic.version ?? '')).providers.add(descriptor.service);
    }
    for (const topic of descriptor.consumes ?? []) {
      this.ensureTopic(topicKey(topic.id, topic.version ?? '')).consumers.add(descriptor.service);
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
   * window), PLUS the §4.2 observed-only signals derived from trace parentage - per-edge `lastObservedAt`
   * and undeclared-edge `contract-drift` issues. None of this ever touches the declared graph (`providers`/
   * `consumers` on `TopicState`) - only `register` does that. Returns how many events were accepted.
   */
  addEvents(events: readonly MeshTraceEvent[]): number {
    for (const traceEvent of events) {
      // The caller (if any) is whoever currently owns the parent span in the ring window - looked up BEFORE
      // this event's own span joins the index, so an event never resolves itself as its own caller.
      const callerService =
        traceEvent.parentSpanId !== undefined && traceEvent.parentSpanId.length > 0
          ? this.spanIdToService.get(traceEvent.parentSpanId)
          : undefined;

      if (this.ring.length < this.capacity) {
        this.ring.push(traceEvent);
      } else {
        const evicted = this.ring[this.next];
        if (evicted !== undefined) {
          this.spanIdToService.delete(evicted.spanId);
        }
        this.ring[this.next] = traceEvent;
        this.next = (this.next + 1) % this.capacity;
      }
      if (traceEvent.service !== undefined && traceEvent.service.length > 0 && traceEvent.spanId.length > 0) {
        this.spanIdToService.set(traceEvent.spanId, traceEvent.service);
      }

      const failed = !BenzeneResultStatus.isSuccess(traceEvent.status);

      // A wire payload can carry a null/absent status; coalesce it so it never reaches a count key as
      // null-ish (against the §6 "no feed fails ingestion" rule).
      const status = traceEvent.status ?? '';
      const topicRecordKey = topicKey(traceEvent.topic, traceEvent.topicVersion ?? '');
      const topic = this.ensureTopic(topicRecordKey);
      topic.invocations++;
      topic.statusCounts.set(status, (topic.statusCounts.get(status) ?? 0) + 1);
      topic.totalDurationMs += traceEvent.durationMs;
      topic.lastSeen = Date.now();
      if (failed) {
        topic.errors++;
      }

      let providerService: ServiceState | undefined;
      if (traceEvent.service !== undefined && traceEvent.service.length > 0) {
        providerService = this.ensureService(traceEvent.service);
        providerService.invocations++;
        providerService.lastSeen = Date.now();
        if (failed) {
          providerService.errors++;
        }

        // §4.2 "Unobserved": this service just exercised the topic it provides - stamp its liveness.
        topic.providerObservedAt.set(traceEvent.service, Date.now());
      }

      let callerState: ServiceState | undefined;
      if (callerService !== undefined && callerService !== traceEvent.service) {
        callerState = this.services.get(callerService);
        topic.consumerObservedAt.set(callerService, Date.now());
      }

      this.detectContractDrift(traceEvent, providerService, callerService, callerState);
    }
    return events.length;
  }

  /**
   * §4.2 "Undeclared": a REGISTERED service's own traffic naming a topic it never declared. Provider side -
   * the handling service's descriptor doesn't list this topic in `topics`; consumer side - the calling
   * service's descriptor doesn't list it in `consumes`. An anonymous/never-registered service (no descriptor)
   * is never flagged - it has no contract to diverge from. Filed as a `contract-drift` issue, merged by the
   * same fingerprint scheme as a wire-fed `mesh:issues` entry (§4.1).
   */
  private detectContractDrift(
    traceEvent: MeshTraceEvent,
    providerService: ServiceState | undefined,
    callerService: string | undefined,
    callerState: ServiceState | undefined,
  ): void {
    const topicId = traceEvent.topic;
    const version = traceEvent.topicVersion;

    if (
      traceEvent.service !== undefined &&
      providerService?.descriptor !== undefined &&
      !declaresTopic(providerService.descriptor.topics, topicId, version)
    ) {
      this.mergeIssue(driftIssue(traceEvent.service, topicId, version, traceEvent));
    }

    if (
      callerService !== undefined &&
      callerState?.descriptor !== undefined &&
      !declaresTopic(callerState.descriptor.consumes, topicId, version)
    ) {
      this.mergeIssue(driftIssue(callerService, topicId, version, traceEvent));
    }
  }

  /**
   * Ingests an issue batch (spec §4.1): fingerprint-keyed delta merge (`count += delta`, `firstSeen = min`,
   * `lastSeen = max`, exemplars keep the newest ≤3, other fields latest-wins), bounded (evict oldest
   * `lastSeen` when full). Invalid entries (no fingerprint or topic) are skipped, never rejected; an empty
   * batch is the feed's liveness assertion and marks the service's issue feed as wired. Returns how many
   * entries were accepted.
   */
  addIssues(batch: MeshIssueBatch): number {
    this.ensureService(batch.service).issueFeedSeen = true;

    let accepted = 0;
    for (const incoming of batch.issues) {
      if (incoming.fingerprint.length === 0 || incoming.topic.length === 0) {
        continue; // skipped, never rejected (§6: no feed fails ingestion)
      }
      this.mergeIssue(incoming);
      accepted++;
    }
    return accepted;
  }

  /**
   * Merges one issue record (fingerprint-keyed, spec §4.1's delta semantics) into the issue map, bounded
   * (evict oldest `lastSeen` when full). Shared by the wire-fed `mesh:issues` batch above and the
   * collector-synthesized `contract-drift` issues §4.2 produces from trace ingestion - both are "one
   * occurrence, merge by fingerprint," so both funnel through the identical merge/eviction logic. Assumes
   * `incoming.fingerprint`/`incoming.topic` are already non-empty (the caller validates wire-fed entries;
   * synthesized drift issues are always well-formed by construction).
   */
  private mergeIssue(incoming: MeshIssue): void {
    let issue = this.issues.get(incoming.fingerprint);
    if (issue === undefined) {
      if (this.issues.size >= this.maxIssues) {
        // Evict the least recently observed issue - the least actionable one.
        let oldest: MeshIssue | undefined;
        for (const candidate of this.issues.values()) {
          if (oldest === undefined || candidate.lastSeen < oldest.lastSeen) {
            oldest = candidate;
          }
        }
        if (oldest !== undefined) {
          this.issues.delete(oldest.fingerprint);
        }
      }
      issue = new MeshIssue();
      issue.fingerprint = incoming.fingerprint;
      issue.classification = incoming.classification;
      issue.service = incoming.service;
      issue.topic = incoming.topic;
      issue.version = incoming.version;
      issue.firstSeen = incoming.firstSeen;
      issue.lastSeen = incoming.lastSeen;
      this.issues.set(incoming.fingerprint, issue);
    }

    issue.count += incoming.count; // deltas merge by summation - restart-proof, no instance keying
    if (incoming.firstSeen < issue.firstSeen) {
      issue.firstSeen = incoming.firstSeen;
    }
    if (incoming.lastSeen > issue.lastSeen) {
      issue.lastSeen = incoming.lastSeen;
    }
    issue.classification = incoming.classification.length === 0 ? issue.classification : incoming.classification;
    issue.transport = incoming.transport ?? issue.transport;
    issue.status = incoming.status.length === 0 ? issue.status : incoming.status;
    issue.exceptionType = incoming.exceptionType ?? issue.exceptionType;
    issue.resolutionHint = incoming.resolutionHint ?? issue.resolutionHint;
    for (const exemplar of incoming.exemplarTraceIds) {
      if (exemplar.length === 0 || issue.exemplarTraceIds.includes(exemplar)) {
        continue;
      }
      issue.exemplarTraceIds.push(exemplar);
      if (issue.exemplarTraceIds.length > 3) {
        issue.exemplarTraceIds.shift(); // keep the newest
      }
    }
  }

  fleet(range?: MeshTimeRange): FleetView {
    const window = MeshTimeRangeResolver.resolve(range, Date.now());
    const view = new FleetView();
    view.generatedAt = Date.now();
    view.services = [...this.services.keys()]
      .sort(ordinalCompare)
      .map((name) => this.serviceSummary(name));
    view.topics = [...this.topics.keys()]
      .sort(compareTopicKeys)
      .map((key) => this.topicSummary(key));
    // Flows honor the window (ring filtered by trace start); the per-topic/service counts above are
    // cumulative-since-start and can't be sub-windowed - collectorWindow says so.
    view.traces = this.traceSummaries(MaxFleetTraces, window);
    // The merged issue map, newest activity first. NOT window-filtered (a merged map, like the cumulative
    // counts) - readers window on lastSeen client-side. Snapshot copies (JS is single-threaded, so no lock is
    // needed, but the copy keeps a serialized view from reflecting a later ingest merge - the C# snapshot).
    view.issues = [...this.issues.values()]
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map((x) => copyIssue(x));
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
    const summary = this.topicSummary(key);
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
      summary.topics = (state.descriptor.topics ?? []).length;
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
    // Feed-absence only matters when there's failure it should have explained: a service with failing traffic
    // that has never sent a mesh:issues batch (not even the empty liveness one) is flagged; a healthy
    // never-emitting service is indistinguishable from a healthy emitting one, and that's fine (spec §4.1 /
    // drains-up 3.2 ruling).
    if (!state.issueFeedSeen && state.errors > 0) {
      summary.missingFeeds.push('issues');
    }
    return summary;
  }

  /**
   * Providers/consumers are read straight off the DECLARED graph (`TopicState.providers`/`consumers`,
   * populated wholesale by `register` alone - spec §4's 2026-08 revision). `providerActivity`/
   * `consumerActivity` layer the §4.2 "Unobserved" signal on top, additively: one entry per declared
   * edge, `{lastObservedAt}` when trace evidence has ever confirmed it, `{}` (present but empty) when
   * it hasn't - a decommission CANDIDATE, not a verdict (trace export is lossy by design).
   */
  private topicSummary(key: string): TopicSummary {
    const state = this.topics.get(key)!;
    const { id, version } = parseTopicKey(key);
    const summary = new TopicSummary();
    summary.topic = id;
    summary.version = version.length === 0 ? undefined : version;
    summary.providers = [...state.providers].sort(ordinalCompare);
    summary.consumers = [...state.consumers].sort(ordinalCompare);
    summary.providerActivity = activityFor(state.providers, state.providerObservedAt);
    summary.consumerActivity = activityFor(state.consumers, state.consumerObservedAt);
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

/**
 * Projects a declared edge set plus its observed-at map into the §4.2 `TopicActivity` shape: one entry per
 * declared service, `{lastObservedAt}` (ISO-8601) when observed, `{}` when not - present-but-empty is the
 * "declared, never observed" decommission-candidate signal, deliberately distinct from absence.
 */
function activityFor(declared: ReadonlySet<string>, observedAt: ReadonlyMap<string, number>): TopicActivity {
  const activity: TopicActivity = {};
  for (const service of declared) {
    const at = observedAt.get(service);
    activity[service] = at === undefined ? {} : { lastObservedAt: MeshTimeRangeResolver.toIso(at) };
  }
  return activity;
}

/**
 * Whether `topics`/`consumes` (a descriptor's declared list) names `(id, version)` - spec §4.2's "Undeclared"
 * test. `declared` may be `undefined`: a wire-deserialized descriptor with the field genuinely omitted (see
 * `register`'s coalescing note) declares nothing, not everything.
 */
function declaresTopic(
  declared: readonly MeshTopicDescriptor[] | undefined,
  id: string,
  version: string | undefined,
): boolean {
  return (declared ?? []).some((topic) => topic.id === id && (topic.version ?? '') === (version ?? ''));
}

/** Builds the one-occurrence `contract-drift` issue §4.2 synthesizes for an undeclared edge, ready to merge. */
function driftIssue(service: string, topic: string, version: string | undefined, traceEvent: MeshTraceEvent): MeshIssue {
  const status = traceEvent.status ?? '';
  const issue = new MeshIssue();
  issue.fingerprint = MeshIssueFingerprint.compute(
    service,
    topic,
    version,
    MeshIssueClassification.contractDrift,
    traceEvent.exceptionType,
    status,
  );
  issue.classification = MeshIssueClassification.contractDrift;
  issue.service = service;
  issue.topic = topic;
  issue.version = version;
  issue.status = status;
  issue.exceptionType = traceEvent.exceptionType;
  issue.count = 1;
  issue.firstSeen = traceEvent.startedAt;
  issue.lastSeen = traceEvent.startedAt;
  if (traceEvent.traceId.length > 0) {
    issue.exemplarTraceIds = [traceEvent.traceId];
  }
  return issue;
}

// A defensive copy of a stored issue for the fleet view - the C# snapshot that keeps a view serialized outside
// the (JS-absent) lock from tearing as a later ingest merges into the live map.
function copyIssue(x: MeshIssue): MeshIssue {
  const copy = new MeshIssue();
  copy.fingerprint = x.fingerprint;
  copy.classification = x.classification;
  copy.service = x.service;
  copy.topic = x.topic;
  copy.version = x.version;
  copy.transport = x.transport;
  copy.status = x.status;
  copy.exceptionType = x.exceptionType;
  copy.count = x.count;
  copy.firstSeen = x.firstSeen;
  copy.lastSeen = x.lastSeen;
  copy.exemplarTraceIds = [...x.exemplarTraceIds];
  copy.resolutionHint = x.resolutionHint;
  return copy;
}

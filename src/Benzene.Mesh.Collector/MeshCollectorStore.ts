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
 * ENTIRELY from the latest registered `ServiceDescriptor` - `produces` gives provider edges, `topics` gives
 * consumer edges (`register` replaces both wholesale) - never from trace parentage. Trace parentage is kept
 * only as a separate, additive, observed-only signal, layered on top of the declared graph and never fed back
 * into it: a `spanId -> service` index (`spanIdToService`, scoped to the same bounded ring window as the trace
 * queries) lets ingestion notice, per event, which service actually provided/called a topic, which feeds two
 * things that are NOT graph membership - (a) per-edge `lastObservedAt` (`providerObservedAt`/
 * `consumerObservedAt` on `TopicState`, surfaced as `TopicSummary.providerActivity`/`consumerActivity`), the
 * "Unobserved" decommission-candidate signal, and (b) a synthesized `contract-drift` issue (mesh.md §4.1's
 * classification, filed exactly like a wire-fed `benzene:mesh:issues` entry) when a *registered* service's traffic
 * names a topic it never declared providing/consuming - the "Undeclared" signal. An anonymous/never-registered
 * service is never flagged (no descriptor, no contract to diverge from).
 *
 * **Versioned catalog (mesh.md §2.4/§2.5):** the catalog is keyed by `(service, serviceVersion)` -
 * `ServiceState.descriptors`, keyed by `serviceVersion ?? ''` - so two releases deployed side by side
 * are two entries, re-registering one version never disturbs another, per-instance `hashMatches`
 * resolves against every live version's hash (two versions with differing hashes = healthy; the same
 * version re-registered with a different hash = drift), the §4.2 drift check accepts a topic any live
 * version declares, and a `maxVersionsPerService` cap (default 8) bounds retention with the evicted
 * version's edges retracted. The identity is extrinsic - exactly the declared `serviceVersion`, never
 * synthesized from per-boot values or derived from `descriptorHash` - and the producer/consumer graph
 * still collapses versions to one node per service (§4: graph membership is by `service`).
 * Pinned by `mesh-service-version-cases.json`; version ORDERING (§2.5) lives in
 * `@benzenejs/mesh-contracts`' `MeshVersionOrder`, deliberately not consulted here (a catalog must
 * hold unordered and mixed-scheme version sets too).
 *
 * Divergences from the C# original:
 * - `DateTimeOffset` -> epoch-millisecond `number`; `DateTimeOffset.UtcNow` -> `Date.now()`.
 * - The fleet's `services` list carries one row per live `(service, serviceVersion)` entry, where the
 *   C# original keeps one headline row per name: the canonical `mesh-service-version-cases.json`
 *   (which the .NET repo vendors but does not yet run) asserts the per-version rows, and the fixture
 *   wins. The `benzene:mesh:query:service` view stays one-per-name (headline version), matching C#.
 * - Declared edges are rebuilt as the union over all live versions (`rebuildDeclaredEdges`) rather
 *   than retracted pointwise per version (C# `RetractEdges`): a pointwise retraction drops a shared
 *   service-name edge a still-live sibling version also declares - the fixture's
 *   `re-registering-one-version-does-not-disturb-the-other` case pins the union behavior.
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
  /**
   * Every currently live `(service, serviceVersion)` descriptor, keyed by `serviceVersion ?? ''` -
   * the catalog key spec §2.4 requires: two releases deployed side by side (a canary/blue-green) are
   * two independent entries here, neither evicting the other. A re-registration of the SAME key
   * replaces that key's entry wholesale (the pre-§2.4 behavior, unchanged for the versionless '' key);
   * a DIFFERENT key is added alongside, never removing a sibling. Identity is extrinsic (§2.4): the
   * key is exactly what the descriptor declared - never synthesized from a per-boot value, an
   * instanceId, or the descriptorHash (which fingerprints the contract, precisely what §2.4 says a
   * version is NOT defined by).
   */
  readonly descriptors = new Map<string, MeshServiceDescriptor>();

  /**
   * Monotonic registration-order stamp per version key, set every time {@link descriptors} gains or
   * refreshes that key - what makes "least-recently-registered" well-defined for the
   * `maxVersionsPerService` eviction ordering. Deliberately a sequence counter, NOT a wall-clock
   * `createdAtUtc`: §2.5 rules build time out as an ordering substitute or tiebreak, and eviction
   * bookkeeping must not smuggle one back in.
   */
  readonly descriptorRegisteredAt = new Map<string, number>();

  /**
   * The most recently registered version's key. The service-NAME-level `benzene:mesh:query:service` view
   * (its scalar runtime/binding/placement/topics/serviceVersion/descriptor fields) reports THIS
   * version, preserving the one-view-per-name shape for callers that query by name alone. Older
   * still-live versions remain fully present in {@link descriptors} (and in the topic catalog's
   * providers/consumers, and per-version on the fleet list) for hash comparison and the declared graph.
   */
  currentVersionKey?: string;

  readonly instances = new Map<string, InstanceState>();
  lastSeen = 0;
  invocations = 0;
  errors = 0;
  // True once ANY benzene:mesh:issues batch (including an empty liveness batch) named this service - what lets "quiet
  // wired feed" be distinguished from "feed not wired" (spec §4.1).
  issueFeedSeen = false;

  /** The "headline" (most recently registered) version's descriptor, or `undefined` before any registration. */
  get descriptor(): MeshServiceDescriptor | undefined {
    return this.currentVersionKey === undefined ? undefined : this.descriptors.get(this.currentVersionKey);
  }
}

class TopicState {
  // Declared graph membership (mesh.md §4): providers from every registered ServiceDescriptor's
  // `produces`, consumers from its `topics` - handling a topic makes you its consumer, the way every
  // broker in the field uses the word. Populated/replaced wholesale by `register`
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
  private readonly maxVersionsPerService: number;
  private versionSequence = 0;
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

  /**
   * @param maxVersionsPerService The retention cap on how many distinct `(service, serviceVersion)`
   * descriptors a single service name may hold at once - side-by-side deployments realistically hold
   * 2-3 live versions; 8 gives generous headroom without accumulating one permanent entry per
   * historical deploy for the life of a long-running collector process. See {@link evictOneVersion}.
   */
  constructor(maxTraceEvents = 4096, maxIssues = 1024, maxVersionsPerService = 8) {
    this.capacity = maxTraceEvents;
    this.maxIssues = maxIssues;
    this.maxVersionsPerService = maxVersionsPerService;
  }

  /**
   * Stores the descriptor as the current contract of its `(service, serviceVersion)` catalog key
   * (spec §2.4/§4): a re-registration of the SAME key replaces that key's entry - and its share of
   * the declared graph - wholesale, so a redeploy that drops a topic from `topics` drops the consumer
   * edge with it and one that drops a topic from `produces` drops the provider edge with it,
   * symmetrically (spec §4). A DIFFERENT key registers alongside, never disturbing a still-live
   * sibling version: two releases deployed side by side is the expected canary/blue-green state.
   * This is the ONLY thing that ever changes the declared graph.
   */
  register(descriptor: MeshServiceDescriptor): void {
    const state = this.ensureService(descriptor.service);
    const versionKey = descriptor.serviceVersion ?? '';

    if (!state.descriptors.has(versionKey) && state.descriptors.size >= this.maxVersionsPerService) {
      // versionKey is a brand-new key, not yet in descriptors, and is about to become
      // currentVersionKey below - so it is never itself an eviction candidate here, and the OLD
      // current version's protection lapses the instant its successor registers (it stops being
      // this service's headline the moment this call completes).
      this.evictOneVersion(state);
    }

    state.descriptors.set(versionKey, descriptor);
    state.descriptorRegisteredAt.set(versionKey, ++this.versionSequence);
    state.currentVersionKey = versionKey;
    state.lastSeen = Date.now();

    this.rebuildDeclaredEdges(descriptor.service, state);
  }

  /**
   * Recomputes the service's declared provider/consumer edges as the union over EVERY currently live
   * version's `topics`/`produces` (spec §4: graph membership is by `service`, not by
   * `(service, serviceVersion)` - two live versions both declaring a topic contribute ONE edge, and
   * the graph still collapses to one node per service). Rebuilding from the live set - rather than
   * retracting one version's edges pointwise, as the C# original's `RetractEdges` does - is what
   * keeps an edge a still-live sibling version also declares when one version re-registers without
   * it or is evicted: the fixture's `re-registering-one-version-does-not-disturb-the-other` case
   * (`mesh-service-version-cases.json`) pins exactly that, and a pointwise retraction of the shared
   * service-name edge would drop it. Never touches any other service's edges.
   */
  private rebuildDeclaredEdges(service: string, state: ServiceState): void {
    for (const topic of this.topics.values()) {
      topic.providers.delete(service);
      topic.consumers.delete(service);
    }

    for (const live of state.descriptors.values()) {
      // A wire body is deserialized straight off parsed JSON (no class construction), so an omitted
      // `topics`/`produces` - legal on the wire, e.g. a service that declares no outbound registration -
      // is genuinely `undefined` here, not the class field's `[]` default. Coalesce rather than assume,
      // against the §6 "no feed fails ingestion" rule.
      for (const topic of live.topics ?? []) {
        this.ensureTopic(topicKey(topic.id, topic.version ?? '')).consumers.add(service);
      }
      for (const topic of live.produces ?? []) {
        this.ensureTopic(topicKey(topic.id, topic.version ?? '')).providers.add(service);
      }
    }
  }

  /**
   * Evicts one version from `state.descriptors` when a brand-new version registration would otherwise
   * push the service over `maxVersionsPerService` - without a cap, a service that legitimately
   * re-registers under a new `serviceVersion` on every deploy accumulates one permanent entry per
   * historical deploy for the life of a long-running collector process. Preference order: the
   * least-recently-registered version (by {@link ServiceState.descriptorRegisteredAt}) that has NO
   * live instance currently reporting its `descriptorHash` ({@link hasLiveInstance}); if every
   * retained version has one, the cap still wins and the least-recently-registered version is evicted
   * regardless - this is a bounded in-memory diagnostic store, not a health signal. The evicted
   * version's provider/consumer edges are retracted by the caller's {@link rebuildDeclaredEdges}
   * pass, so nothing is left dangling in the topic catalog. This is deliberately a registration-order
   * cap, not a TTL (and never a §2.5 version-order judgement - eviction must work for unordered and
   * mixed-scheme version sets too).
   */
  private evictOneVersion(state: ServiceState): void {
    let deadVictim: string | undefined;
    let deadVictimOrder = Number.MAX_SAFE_INTEGER;
    let anyVictim: string | undefined;
    let anyVictimOrder = Number.MAX_SAFE_INTEGER;

    for (const [key, live] of state.descriptors) {
      const order = state.descriptorRegisteredAt.get(key) ?? 0;
      if (order < anyVictimOrder) {
        anyVictim = key;
        anyVictimOrder = order;
      }
      if (!hasLiveInstance(state, live.descriptorHash) && order < deadVictimOrder) {
        deadVictim = key;
        deadVictimOrder = order;
      }
    }

    const evictKey = deadVictim ?? anyVictim;
    if (evictKey === undefined) {
      return; // nothing to evict (descriptors is empty)
    }

    state.descriptors.delete(evictKey);
    state.descriptorRegisteredAt.delete(evictKey);
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

        // §4.2 "Unobserved": this service just handled the topic it consumes - stamp its liveness.
        topic.consumerObservedAt.set(traceEvent.service, Date.now());
      }

      let callerState: ServiceState | undefined;
      if (callerService !== undefined && callerService !== traceEvent.service) {
        callerState = this.services.get(callerService);
        // The caller SENT the message, so it is the provider on this edge.
        topic.providerObservedAt.set(callerService, Date.now());
      }

      this.detectContractDrift(traceEvent, providerService, callerService, callerState);
    }
    return events.length;
  }

  /**
   * §4.2 "Undeclared": a REGISTERED service's own traffic naming a topic it never declared. Consumer side -
   * no live version's descriptor lists this topic in `topics`; provider side - no live version's descriptor
   * lists it in `produces`. Checked across EVERY currently live `(service, serviceVersion)` descriptor, not
   * just the most-recently-registered ("headline") one - otherwise the moment a second version registers,
   * every message an older-but-still-live version legitimately handles would be misfiled as drift (the
   * side-by-side false positive §2.4 exists to prevent, the same any-live-version rule {@link hashMatches}
   * applies). Accepted trade-off, documented rather than a silent false positive: `MeshTraceEvent` carries
   * no per-event `serviceVersion` (a cross-language wire-shape question owned by the spec repo), so a
   * genuine single-version drift on an edge another live version happens to also declare goes undetected
   * until that other version retires. An anonymous/never-registered service (no descriptor) is never
   * flagged - it has no contract to diverge from. Filed as a `contract-drift` issue, merged by the same
   * fingerprint scheme as a wire-fed `benzene:mesh:issues` entry (§4.1).
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
      providerService !== undefined &&
      providerService.descriptors.size > 0 &&
      !declaresTopicInAnyLiveVersion(providerService, 'topics', topicId, version)
    ) {
      this.mergeIssue(driftIssue(traceEvent.service, topicId, version, traceEvent));
    }

    if (
      callerService !== undefined &&
      callerState !== undefined &&
      callerState.descriptors.size > 0 &&
      !declaresTopicInAnyLiveVersion(callerState, 'produces', topicId, version)
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
    for (const incoming of batch.issues ?? []) {
      // A deserialized batch is a plain JSON object, so `MeshIssue`'s field defaults never ran: a
      // member the emitter omitted is `undefined` here, not `''`/`[]`. Read every one defensively -
      // a malformed entry must be SKIPPED, never throw, or one bad entry rejects the whole batch
      // (§6: no feed fails ingestion).
      if ((incoming.fingerprint ?? '').length === 0 || (incoming.topic ?? '').length === 0) {
        continue; // skipped, never rejected (§6: no feed fails ingestion)
      }
      this.mergeIssue(incoming);
      accepted++;
    }
    return accepted;
  }

  /**
   * Merges one issue record (fingerprint-keyed, spec §4.1's delta semantics) into the issue map, bounded
   * (evict oldest `lastSeen` when full). Shared by the wire-fed `benzene:mesh:issues` batch above and the
   * collector-synthesized `contract-drift` issues §4.2 produces from trace ingestion - both are "one
   * occurrence, merge by fingerprint," so both funnel through the identical merge/eviction logic. Assumes
   * `incoming.fingerprint`/`incoming.topic` are already non-empty (the caller validates wire-fed entries;
   * synthesized drift issues are always well-formed by construction), but every OTHER member is read
   * defensively: a wire-fed entry is a plain deserialized object, so an omitted member is `undefined`
   * rather than the class's declared default.
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
      issue.classification = incoming.classification ?? '';
      issue.service = incoming.service ?? '';
      issue.topic = incoming.topic;
      issue.version = incoming.version;
      issue.firstSeen = incoming.firstSeen ?? 0;
      issue.lastSeen = incoming.lastSeen ?? 0;
      this.issues.set(incoming.fingerprint, issue);
    }

    issue.count += incoming.count ?? 0; // deltas merge by summation - restart-proof, no instance keying
    if (incoming.firstSeen < issue.firstSeen) {
      issue.firstSeen = incoming.firstSeen;
    }
    if (incoming.lastSeen > issue.lastSeen) {
      issue.lastSeen = incoming.lastSeen;
    }
    issue.classification =
      (incoming.classification ?? '').length === 0 ? issue.classification : incoming.classification;
    issue.transport = incoming.transport ?? issue.transport;
    issue.status = (incoming.status ?? '').length === 0 ? issue.status : incoming.status;
    issue.exceptionType = incoming.exceptionType ?? issue.exceptionType;
    issue.resolutionHint = incoming.resolutionHint ?? issue.resolutionHint;
    // Wire-optional: an emitter with no exemplar to offer omits the member entirely.
    for (const exemplar of incoming.exemplarTraceIds ?? []) {
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
    // One row per live (service, serviceVersion) catalog entry (spec §2.4; pinned by
    // mesh-service-version-cases.json) - two releases deployed side by side are two rows, never one
    // silently overwriting the other. A service with no descriptor yet (anonymous but live) is one
    // row; a versionless descriptor keys as '' and stays one row, exactly as before §2.4 existed.
    // NOTE this deliberately diverges from the C# original, whose fleet keeps one headline row per
    // NAME: the canonical fixture asserts the per-version rows, and the spec wins over the port.
    // Version keys sort ordinally for a stable listing - a display order, NOT a §2.5 version-order
    // claim (which would require a declared scheme and must never be guessed).
    view.services = [...this.services.keys()]
      .sort(ordinalCompare)
      .flatMap((name) => this.serviceSummaries(name));
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

    // One view per service NAME, describing the "headline" (most recently registered) version's
    // scalar fields - the per-version breakdown lives on the fleet list. Matches the C# original.
    const summary = this.serviceSummary(name, state, state.descriptor);
    const view = new ServiceView();
    view.service = summary.service;
    view.runtime = summary.runtime;
    view.binding = summary.binding;
    view.placement = summary.placement;
    view.topics = summary.topics;
    view.serviceVersion = summary.serviceVersion;
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
        instanceView.hashMatches = hashMatches(state, instance.descriptorHash);
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

  /**
   * The fleet rows for one service name: one {@link ServiceSummary} per live `(service, serviceVersion)`
   * catalog entry (spec §2.4), or a single descriptor-less row for a service known only from traffic.
   * The name-level signals (instances/health/stats/missing feeds) repeat on every version's row -
   * heartbeats and traces carry no `serviceVersion`, so they cannot be attributed per version.
   */
  private serviceSummaries(name: string): ServiceSummary[] {
    const state = this.services.get(name)!;
    if (state.descriptors.size === 0) {
      return [this.serviceSummary(name, state, undefined)];
    }
    return [...state.descriptors.keys()]
      .sort(ordinalCompare)
      .map((versionKey) => this.serviceSummary(name, state, state.descriptors.get(versionKey)));
  }

  private serviceSummary(
    name: string,
    state: ServiceState,
    descriptor: MeshServiceDescriptor | undefined,
  ): ServiceSummary {
    const summary = new ServiceSummary();
    summary.service = name;
    summary.health = MeshHealth.unknown;
    summary.lastSeen = state.lastSeen;
    summary.instances = state.instances.size;
    summary.invocations = state.invocations;
    summary.errors = state.errors;

    if (descriptor !== undefined) {
      summary.runtime = descriptor.runtime;
      summary.binding = descriptor.binding;
      summary.placement = descriptor.placement;
      summary.topics = (descriptor.topics ?? []).length;
      summary.serviceVersion = descriptor.serviceVersion;
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
    // that has never sent a benzene:mesh:issues batch (not even the empty liveness one) is flagged; a healthy
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
 * Whether `topics`/`produces` (a descriptor's declared list) names `(id, version)` - spec §4.2's "Undeclared"
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

/**
 * Whether ANY currently live version of the service declares `(id, version)` on the relevant side
 * (consumer/`topics` or provider/`produces`). The §4.2 drift check must reason about live versions
 * the same way `hashMatches` does - checking only the headline version would misfile every message
 * an older-but-still-live version legitimately handles as contract drift the moment a newer sibling
 * registers (a healthy side-by-side canary/blue-green deployment read as drift).
 */
function declaresTopicInAnyLiveVersion(
  state: ServiceState,
  side: 'topics' | 'produces',
  id: string,
  version: string | undefined,
): boolean {
  for (const descriptor of state.descriptors.values()) {
    if (declaresTopic(side === 'topics' ? descriptor.topics : descriptor.produces, id, version)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether any currently reporting instance's last heartbeat hash matches this specific version's
 * descriptor hash (a §2.4-shaped liveness signal, reused for the eviction preference) - a version
 * with no descriptor hash can never be "live" by this check (nothing to match), matching
 * {@link hashMatches}'s undefined-is-unknown treatment.
 */
function hasLiveInstance(state: ServiceState, descriptorHash: string | undefined): boolean {
  if (descriptorHash === undefined) {
    return false;
  }
  for (const instance of state.instances.values()) {
    if (instance.descriptorHash === descriptorHash) {
      return true;
    }
  }
  return false;
}

/**
 * Whether an instance's reported hash matches the descriptor of ITS OWN live version (spec §2.4).
 * Compared against EVERY currently registered `(service, serviceVersion)` pair's hash for this
 * service, not just the name-level "headline" row - so two different, live versions each reporting
 * their own correct-but-different hash both read as matching (the expected side-by-side deployment
 * state, explicitly NOT drift per §2.4), and only a hash that matches none of the service's live
 * descriptors reads as drift (the same-version-different-hash case). `undefined` when either side has
 * nothing to compare - no hash reported by the instance, or no live descriptor for the service
 * carries a hash at all - unknown, never treated as drift.
 */
function hashMatches(state: ServiceState, reportedHash: string | undefined): boolean | undefined {
  if (reportedHash === undefined) {
    return undefined;
  }
  const knownHashes = [...state.descriptors.values()]
    .map((descriptor) => descriptor.descriptorHash)
    .filter((hash): hash is string => hash !== undefined);
  return knownHashes.length === 0 ? undefined : knownHashes.includes(reportedHash);
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

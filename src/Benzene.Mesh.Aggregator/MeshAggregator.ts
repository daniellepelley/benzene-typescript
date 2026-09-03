/** Port of Benzene.Mesh.Aggregator.MeshAggregator. */
import { HealthCheckResponse } from '@benzenejs/health-checks-core';
import {
  IMeshUsageSource,
  MeshDeclaredSchema,
  MeshDeclaredSchemaRole,
  MeshManifest,
  MeshManifestEntry,
  MeshRemovedTopic,
  MeshServiceRegistry,
  MeshServiceRegistryEntry,
  MeshServiceSnapshot,
  MeshServiceStatus,
  MeshTopicCatalog,
  MeshTopicChange,
  MeshTopicChangeKind,
  MeshTopicEntry,
  MeshTopicHttpMapping,
  MeshTopicProducer,
  MeshTopicService,
  MeshTopicStatus,
  MeshTopicVersionCompatibility,
  MeshTopology,
  MeshUsage,
  MeshUsageEntry,
  TopologyEdge,
  TopologyEdgeSource,
} from '@benzenejs/mesh-contracts';
import { BenzeneResultStatus } from '@benzenejs/results';
import { AsyncApiCompositor, ServiceDocument } from './AsyncApiCompositor';
import { IMeshArtifactStore } from './IMeshArtifactStore';
import { IMeshServiceSource } from './IMeshServiceSource';
import { MeshSnapshotBuilder } from './MeshSnapshotBuilder';
import { UnknownMeshServiceSource } from './UnknownMeshServiceSource';

type JsonObject = Record<string, unknown>;

// Matches Benzene.HealthChecks.TimeOutHealthCheck's 10-second convention: an explicit, documented bound on
// each fetch rather than relying solely on a source's own (potentially much longer) defaults - one
// slow/hung service shouldn't be able to stall a run. `CancellationTokenSource(timeout)` -> `AbortSignal.timeout`.
const PerServiceFetchTimeoutMs = 10_000;

// The synthesized `result`-tag tokens the metric standard writes onto benzene.messages.processed, which
// become MeshUsageEntry.status for the metrics-backend adapters. Successes collapse to "success"; failures
// are itemized by their real status, plus "exception" for an escaped throw and a legacy "failure" fallback.
const SuccessResult = 'success';
const FailureResult = 'failure';
const ExceptionResult = 'exception';

// A cycle-guard alone bounds recursion by ref name, but an inline (ref-less) self-referential shape has no
// name to guard on - this hard depth cap is the backstop that keeps a pathological spec from stalling a run.
const MaxSchemaDepth = 32;

/** One service's fetch/parse result, threaded through the artifact builders. */
interface ServiceResult {
  readonly snapshot: MeshServiceSnapshot;
  readonly topics: ServiceTopic[];
  readonly outboundTopics: ServiceOutboundTopic[];
  readonly transports: string[];
  readonly asyncApiJson: string | undefined;
}

interface ServiceTopic {
  readonly topic: string;
  readonly version: string;
  readonly reserved: boolean;
  readonly httpMappings: MeshTopicHttpMapping[];
  readonly requestSchema: JsonObject | undefined;
  readonly responseSchema: JsonObject | undefined;
}

interface ServiceOutboundTopic {
  readonly topic: string;
  readonly version: string;
  readonly messageSchema: JsonObject | undefined;
}

/**
 * Polls every service in a `MeshServiceRegistry` for its spec and health documents, computes contract-drift,
 * and publishes the resulting catalog to an `IMeshArtifactStore`. `System.Text.Json` (nodes + document) ->
 * native `JSON.parse`/`JSON.stringify`; `DateTimeOffset` clock -> `() => number` (epoch ms); `Task.WhenAll`
 * -> `Promise.all`; LINQ `GroupBy`/`ToDictionary` -> `Map`s.
 */
export class MeshAggregator {
  private readonly sources: Map<string, IMeshServiceSource>;
  private readonly store: IMeshArtifactStore;
  private readonly clock: () => number;
  private readonly usageSources: IMeshUsageSource[];

  /**
   * @param sources Every registered `IMeshServiceSource`, keyed by `key` (case-insensitive) to resolve each
   * entry's `source` against. An entry whose `source` has no matching source here is recorded as that
   * service's own fetch error, not a run-wide failure.
   * @param store Where generated catalog artifacts are published (and, for drift comparison, read back from).
   * @param clock Supplies the current time (epoch ms); defaults to `Date.now`. Overridable for deterministic tests.
   * @param usageSources Every registered `IMeshUsageSource`. Optional and empty by default: with none
   * registered no `usage.json` is ever published, so the artifact's absence keeps meaning "no usage feed wired".
   */
  constructor(
    sources: Iterable<IMeshServiceSource>,
    store: IMeshArtifactStore,
    clock?: () => number,
    usageSources?: Iterable<IMeshUsageSource>,
  ) {
    this.sources = new Map<string, IMeshServiceSource>();
    for (const source of sources) {
      this.sources.set(source.key.toLowerCase(), source);
    }
    this.store = store;
    this.clock = clock ?? (() => Date.now());
    this.usageSources = usageSources ? [...usageSources] : [];
  }

  /**
   * Polls every registered service once, publishing a `services/{name}.json` snapshot per service and a
   * top-level `manifest.json` summarizing all of them. A single service's spec/health fetch failing (or
   * timing out) does not prevent the rest from being processed and published. Services are polled
   * concurrently, so one slow service adds to the run's total time only up to its own timeout.
   */
  async runOnceAsync(registry: MeshServiceRegistry): Promise<MeshManifest> {
    const entries = registry.services;
    // Usage adapters are polled concurrently with the services themselves - independent I/O.
    const usagePromise = this.fetchUsageAsync();
    const results = await Promise.all(entries.map((entry) => this.buildServiceAsync(entry)));

    // Build every artifact's content first (cheap, in-memory), then publish them all concurrently.
    const manifestEntries: MeshManifestEntry[] = [];
    const writes: Promise<void>[] = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const snapshot = results[i]!.snapshot;
      writes.push(this.store.publishAsync(`services/${entry.name}.json`, JSON.stringify(snapshot, null, 2)));

      manifestEntries.push(
        new MeshManifestEntry(
          entry.name,
          determineStatus(snapshot),
          snapshot.contractDrift,
          entry.specUrl,
          entry.healthUrl,
          entry.owningTeam,
          [...results[i]!.transports],
          snapshot.fetchedAtUtc,
        ),
      );
    }

    const manifest = new MeshManifest(this.clock(), manifestEntries);
    writes.push(this.store.publishAsync('manifest.json', JSON.stringify(manifest, null, 2)));

    // Cross-service topic catalog, diffed against the previous run's own catalog.
    const catalog = await this.applyCatalogDiffAsync(this.buildTopicCatalog(entries, results));
    writes.push(this.store.publishAsync('topics.json', JSON.stringify(catalog, null, 2)));

    // Observed usage is awaited here - before the topology below - so structural edges can carry a
    // usage-derived req/min + error rate where the feed can attribute one honestly.
    const usage = await usagePromise;

    // Structural ("designed to call") topology derived from the specs.
    const topology = this.buildTopology(entries, results, usage);
    writes.push(this.store.publishAsync('topology.json', JSON.stringify(topology, null, 2)));

    // Composite AsyncAPI: merge every service's own AsyncAPI doc into one fleet-wide document.
    writes.push(this.store.publishAsync('asyncapi.json', this.buildCompositeAsyncApi(entries, results)));

    if (usage !== undefined) {
      writes.push(this.store.publishAsync('usage.json', JSON.stringify(usage, null, 2)));
    }

    await Promise.all(writes);

    return manifest;
  }

  /**
   * Polls every registered usage adapter (bounded by the per-service timeout each; a throwing/timing-out
   * source contributes nothing rather than failing the run) and merges the reports into one `MeshUsage`.
   * Returns `undefined` when no source reported.
   */
  private async fetchUsageAsync(): Promise<MeshUsage | undefined> {
    if (this.usageSources.length === 0) {
      return undefined;
    }

    const reports = await Promise.all(this.usageSources.map((source) => this.fetchOneUsageAsync(source)));
    const available = reports.filter((report): report is MeshUsage => report !== undefined);
    if (available.length === 0) {
      return undefined;
    }

    return new MeshUsage(
      this.clock(),
      minDefined(available.map((report) => report.windowStartUtc)),
      maxDefined(available.map((report) => report.windowEndUtc)),
      available.flatMap((report) => report.entries),
    );
  }

  private async fetchOneUsageAsync(source: IMeshUsageSource): Promise<MeshUsage | undefined> {
    try {
      return await source.fetchUsageAsync(AbortSignal.timeout(PerServiceFetchTimeoutMs));
    } catch {
      return undefined;
    }
  }

  /**
   * Builds the composite AsyncAPI document from every service that returned an AsyncAPI doc, passing each
   * service's reserved-topic ids (from its benzene spec) so utility channels are dropped.
   */
  private buildCompositeAsyncApi(entries: MeshServiceRegistryEntry[], results: ServiceResult[]): string {
    const documents: ServiceDocument[] = [];
    for (let i = 0; i < entries.length; i++) {
      const asyncApiJson = results[i]!.asyncApiJson;
      if (asyncApiJson === undefined || asyncApiJson.trim().length === 0) {
        continue;
      }

      const reserved = new Set(
        results[i]!.topics.filter((topic) => topic.reserved).map((topic) => topic.topic),
      );

      documents.push({ serviceName: entries[i]!.name, asyncApiJson, reservedTopics: reserved });
    }

    return AsyncApiCompositor.merge(documents, this.clock());
  }

  /**
   * Derives the structural topology: for every domain topic a service declares it *sends* (the spec's
   * `events`), an edge to every service that *handles* it (the spec's `requests`). Where the merged `usage`
   * feed can attribute a topic's observed traffic to a specific edge *unambiguously*, that edge also carries
   * a usage-derived req/min and (when the outcome is classifiable) error rate.
   */
  private buildTopology(
    entries: MeshServiceRegistryEntry[],
    results: ServiceResult[],
    usage: MeshUsage | undefined,
  ): MeshTopology {
    // Consumers of a topic (spec `requests`, non-reserved) and producers of it (spec `events`).
    const consumersByTopic = new Map<string, string[]>();
    const producersByTopic = new Map<string, string[]>();
    for (let i = 0; i < entries.length; i++) {
      for (const topic of results[i]!.topics.filter((t) => !t.reserved)) {
        pushInto(consumersByTopic, topic.topic, entries[i]!.name);
      }
      for (const topic of results[i]!.outboundTopics) {
        pushInto(producersByTopic, topic.topic, entries[i]!.name);
      }
    }

    // Dedup on the (client, server) pair itself (pairKey is collision-free), remembering the topics each
    // edge carries so usage can be attributed per edge.
    const order: { client: string; server: string }[] = [];
    const carriedByEdge = new Map<string, string[]>();
    for (let i = 0; i < entries.length; i++) {
      const client = entries[i]!.name;
      // Topology edges are topic-id-level, not version-level.
      for (const topic of results[i]!.outboundTopics) {
        const servers = consumersByTopic.get(topic.topic);
        if (servers === undefined) {
          continue;
        }
        for (const server of servers) {
          if (server.toLowerCase() === client.toLowerCase()) {
            continue; // a service calling itself isn't a mesh edge
          }
          const key = pairKey(client, server);
          let carried = carriedByEdge.get(key);
          if (carried === undefined) {
            carried = [];
            carriedByEdge.set(key, carried);
            order.push({ client, server });
          }
          if (!carried.includes(topic.topic)) {
            carried.push(topic.topic);
          }
        }
      }
    }

    const windowMinutes =
      usage?.windowStartUtc !== undefined && usage?.windowEndUtc !== undefined
        ? (usage.windowEndUtc - usage.windowStartUtc) / 60_000
        : 0;
    const entriesByTopic = new Map<string, MeshUsageEntry[]>();
    if (usage !== undefined) {
      for (const entry of usage.entries) {
        pushInto(entriesByTopic, entry.topic, entry);
      }
    }

    const edges: TopologyEdge[] = [];
    for (const key of order) {
      const carried = carriedByEdge.get(pairKey(key.client, key.server))!;
      const [requestsPerMinute, errorRate] = attributeEdge(
        carried,
        key.server,
        producersByTopic,
        consumersByTopic,
        entriesByTopic,
        windowMinutes,
      );
      edges.push(
        new TopologyEdge(
          key.client,
          key.server,
          TopologyEdgeSource.structural,
          requestsPerMinute,
          errorRate,
          undefined,
          undefined,
          undefined,
        ),
      );
    }

    return new MeshTopology(this.clock(), edges);
  }

  /**
   * Builds the cross-service topic catalog: every (topic, version) pair seen anywhere in the fleet, who
   * consumes it (spec `requests`) and who produces it (spec `events`), plus an informational status.
   */
  private buildTopicCatalog(entries: MeshServiceRegistryEntry[], results: ServiceResult[]): MeshTopicCatalog {
    const byTopic = new Map<string, TopicAggregate>();
    for (let i = 0; i < entries.length; i++) {
      for (const topic of results[i]!.topics) {
        const aggregate = getOrAddAggregate(byTopic, topic.topic, topic.version);
        aggregate.reserved = aggregate.reserved || topic.reserved;
        aggregate.consumers.push(new MeshTopicService(entries[i]!.name, topic.httpMappings));
        aggregate.consumerSchemas.push({
          service: entries[i]!.name,
          request: topic.requestSchema,
          response: topic.responseSchema,
        });
      }

      for (const outbound of results[i]!.outboundTopics) {
        const aggregate = getOrAddAggregate(byTopic, outbound.topic, outbound.version);
        aggregate.producers.push(new MeshTopicProducer(entries[i]!.name));
        aggregate.producerSchemas.push({ service: entries[i]!.name, message: outbound.messageSchema });
        aggregate.messageSchema = aggregate.messageSchema ?? outbound.messageSchema;
      }
    }

    const topics = [...byTopic.values()]
      .map((aggregate) => buildTopicEntry(aggregate.topic, aggregate.version, aggregate))
      .sort((a, b) => {
        const reserved = (a.reserved ? 1 : 0) - (b.reserved ? 1 : 0); // domain topics first, utilities last
        if (reserved !== 0) return reserved;
        const topic = ordinalCompare(a.topic, b.topic);
        if (topic !== 0) return topic;
        return ordinalCompare(a.version, b.version);
      });

    const versionCompatibility = buildVersionCompatibility(byTopic);

    return new MeshTopicCatalog(this.clock(), topics, [], versionCompatibility);
  }

  /**
   * Annotates the freshly-built catalog with what changed since the previous run, by reading back the
   * store's own last `topics.json`. A first run, or an unreadable/unparseable previous catalog, claims no
   * changes at all - never a wall of "added" noise, and never a failed run.
   */
  private async applyCatalogDiffAsync(catalog: MeshTopicCatalog): Promise<MeshTopicCatalog> {
    let previous: PreviousCatalog | undefined;
    try {
      const previousJson = await this.store.tryReadAsync('topics.json');
      if (previousJson !== undefined) {
        previous = JSON.parse(previousJson) as PreviousCatalog;
      }
    } catch {
      // No previous catalog to diff against this run; the fresh catalog still publishes.
    }

    if (previous === undefined || previous === null || !Array.isArray(previous.topics)) {
      return catalog;
    }

    const previousByKey = new Map<string, PreviousTopicEntry>();
    for (const entry of previous.topics) {
      const key = pairKey(entry.topic, entry.version);
      if (!previousByKey.has(key)) {
        previousByKey.set(key, entry);
      }
    }

    const topics = catalog.topics.map((entry) => diffTopicEntry(entry, previousByKey));

    const currentKeys = new Set(catalog.topics.map((entry) => pairKey(entry.topic, entry.version)));
    const removed = previous.topics
      .filter((entry) => !entry.reserved && !currentKeys.has(pairKey(entry.topic, entry.version)))
      .map((entry) => new MeshRemovedTopic(entry.topic, entry.version))
      .sort((a, b) => ordinalCompare(a.topic, b.topic) || ordinalCompare(a.version, b.version));

    // Version compatibility is derived from the current fleet, not the diff - carry it through unchanged.
    return new MeshTopicCatalog(catalog.generatedAtUtc, topics, removed, catalog.versionCompatibility);
  }

  private async buildServiceAsync(entry: MeshServiceRegistryEntry): Promise<ServiceResult> {
    const source = this.resolveSource(entry.source);

    // The spec, health and (best-effort) AsyncAPI fetches are independent, so run them concurrently.
    const [specResult, healthResult, asyncApiJson] = await Promise.all([
      this.fetchSpecAsync(source, entry),
      this.fetchHealthAsync(source, entry),
      this.fetchAsyncApiAsync(source, entry),
    ]);

    // Preserve the previous precedence: a spec-fetch error is recorded first, otherwise the health one.
    const error = specResult.error ?? healthResult.error;

    const snapshot = await MeshSnapshotBuilder.buildAsync(
      this.store,
      entry.name,
      this.clock(),
      specResult.specJson,
      healthResult.health,
      error,
    );
    return {
      snapshot,
      topics: parseTopics(specResult.specJson),
      outboundTopics: parseOutboundTopics(specResult.specJson),
      transports: parseTransports(specResult.specJson),
      asyncApiJson,
    };
  }

  private async fetchSpecAsync(
    source: IMeshServiceSource,
    entry: MeshServiceRegistryEntry,
  ): Promise<{ specJson: string | undefined; error: string | undefined }> {
    try {
      return { specJson: await source.fetchSpecAsync(entry, AbortSignal.timeout(PerServiceFetchTimeoutMs)), error: undefined };
    } catch (ex) {
      // Type name only, never the message - this artifact aggregates across services into something with
      // broader visibility than one service's own health endpoint.
      return { specJson: undefined, error: errorName(ex) };
    }
  }

  private async fetchHealthAsync(
    source: IMeshServiceSource,
    entry: MeshServiceRegistryEntry,
  ): Promise<{ health: HealthCheckResponse | undefined; error: string | undefined }> {
    try {
      const healthJson = await source.fetchHealthAsync(entry, AbortSignal.timeout(PerServiceFetchTimeoutMs));
      return { health: JSON.parse(healthJson) as HealthCheckResponse, error: undefined };
    } catch (ex) {
      return { health: undefined, error: errorName(ex) };
    }
  }

  private async fetchAsyncApiAsync(
    source: IMeshServiceSource,
    entry: MeshServiceRegistryEntry,
  ): Promise<string | undefined> {
    // AsyncAPI is fetched best-effort and additively: a failure here (or a source that can't serve
    // type=asyncapi) never affects this service's own status/snapshot.
    try {
      if (source.tryFetchSpecAsync === undefined) {
        return undefined;
      }
      return await source.tryFetchSpecAsync(entry, 'asyncapi', AbortSignal.timeout(PerServiceFetchTimeoutMs));
    } catch {
      return undefined;
    }
  }

  private resolveSource(sourceKey: string): IMeshServiceSource {
    return this.sources.get(sourceKey.toLowerCase()) ?? new UnknownMeshServiceSource(sourceKey);
  }
}

// KEYED BY SERVICE (matching the C# original's TopicAggregate): the mismatch attribution
// (`declaredSchemas`) needs the declaring service's name, and a parallel-list coupling against
// `consumers`/`producers` would be an invariant nothing enforces and nothing states.
interface ConsumerSchemas {
  readonly service: string;
  readonly request: JsonObject | undefined;
  readonly response: JsonObject | undefined;
}

interface ProducerSchema {
  readonly service: string;
  readonly message: JsonObject | undefined;
}

class TopicAggregate {
  reserved = false;
  readonly consumers: MeshTopicService[] = [];
  readonly producers: MeshTopicProducer[] = [];
  readonly consumerSchemas: ConsumerSchemas[] = [];
  readonly producerSchemas: ProducerSchema[] = [];
  messageSchema: JsonObject | undefined;

  constructor(
    readonly topic: string,
    readonly version: string,
  ) {}
}

interface PreviousCatalog {
  topics: PreviousTopicEntry[];
}

interface PreviousTopicEntry {
  topic: string;
  version: string;
  reserved: boolean;
  requestSchema?: JsonObject;
  responseSchema?: JsonObject;
  messageSchema?: JsonObject;
  producers: { service: string }[];
  consumers: { service: string }[];
}

function getOrAddAggregate(byTopic: Map<string, TopicAggregate>, topic: string, version: string): TopicAggregate {
  const key = pairKey(topic, version);
  let aggregate = byTopic.get(key);
  if (aggregate === undefined) {
    aggregate = new TopicAggregate(topic, version);
    byTopic.set(key, aggregate);
  }
  return aggregate;
}

/**
 * Reconciles, per non-reserved topic id, the set of versions the fleet produces against the set it
 * consumes. Only topics with more than one version in play, or an outright skew, get an entry.
 */
function buildVersionCompatibility(byTopic: Map<string, TopicAggregate>): MeshTopicVersionCompatibility[] {
  const byTopicId = new Map<string, TopicAggregate[]>();
  for (const aggregate of byTopic.values()) {
    if (aggregate.reserved) {
      continue;
    }
    pushInto(byTopicId, aggregate.topic, aggregate);
  }

  const result: MeshTopicVersionCompatibility[] = [];
  for (const [topic, group] of byTopicId) {
    const produced = distinctOrdinal(group.filter((a) => a.producers.length > 0).map((a) => a.version));
    const consumed = distinctOrdinal(group.filter((a) => a.consumers.length > 0).map((a) => a.version));

    const distinctVersions = new Set([...produced, ...consumed]).size;

    // Only a topic that actually exists at more than one version has a version-compatibility question.
    if (distinctVersions <= 1) {
      continue;
    }

    const consumedSet = new Set(consumed);
    const producedSet = new Set(produced);
    const producedNotConsumed = produced.filter((v) => !consumedSet.has(v)).sort(ordinalCompare);
    const consumedNotProduced = consumed.filter((v) => !producedSet.has(v)).sort(ordinalCompare);

    result.push(new MeshTopicVersionCompatibility(topic, produced, consumed, producedNotConsumed, consumedNotProduced));
  }

  return result.sort((a, b) => ordinalCompare(a.topic, b.topic));
}

function diffTopicEntry(entry: MeshTopicEntry, previousByKey: Map<string, PreviousTopicEntry>): MeshTopicEntry {
  if (entry.reserved) {
    return entry; // utility topic churn is noise
  }

  const previous = previousByKey.get(pairKey(entry.topic, entry.version));
  if (previous === undefined) {
    return withChanges(entry, [new MeshTopicChange(MeshTopicChangeKind.added, 'Not declared anywhere in the previous run')]);
  }

  const changes: MeshTopicChange[] = [];

  const changedSides: string[] = [];
  if (canonical(entry.requestSchema) !== canonical(previous.requestSchema)) changedSides.push('request');
  if (canonical(entry.responseSchema) !== canonical(previous.responseSchema)) changedSides.push('response');
  if (canonical(entry.messageSchema) !== canonical(previous.messageSchema)) changedSides.push('message');
  if (changedSides.length > 0) {
    changes.push(new MeshTopicChange(MeshTopicChangeKind.schemaChanged, 'Payload schema changed (' + changedSides.join(', ') + ')'));
  }

  addParticipantSetChange(
    changes,
    MeshTopicChangeKind.producersChanged,
    'Producers',
    previous.producers.map((producer) => producer.service),
    entry.producers.map((producer) => producer.service),
  );
  addParticipantSetChange(
    changes,
    MeshTopicChangeKind.consumersChanged,
    'Consumers',
    previous.consumers.map((consumer) => consumer.service),
    entry.consumers.map((consumer) => consumer.service),
  );

  return changes.length > 0 ? withChanges(entry, changes) : entry;
}

function addParticipantSetChange(
  changes: MeshTopicChange[],
  kind: string,
  label: string,
  before: string[],
  after: string[],
): void {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added = [...afterSet].filter((name) => !beforeSet.has(name)).sort(ordinalCompare).map((name) => '+' + name);
  const removed = [...beforeSet].filter((name) => !afterSet.has(name)).sort(ordinalCompare).map((name) => '-' + name);
  const deltas = [...added, ...removed];
  if (deltas.length > 0) {
    changes.push(new MeshTopicChange(kind, label + ' changed: ' + deltas.join(', ')));
  }
}

/**
 * Re-stamps `entry` with its run-over-run `changes`, carrying every other field — **including
 * `declaredSchemas`** — through untouched. That last clause is load-bearing (the C# original documents the
 * same trap on its `compatibility` field): the catalogue is built first and only then diffed against the
 * previous run, so a rebuild here that omitted a field would drop it from precisely the topics that just
 * changed — the ones a reader opens the page to judge.
 */
function withChanges(entry: MeshTopicEntry, changes: MeshTopicChange[]): MeshTopicEntry {
  return new MeshTopicEntry(
    entry.topic,
    entry.version,
    entry.reserved,
    entry.consumers,
    entry.producers,
    entry.status,
    entry.requestSchema,
    entry.responseSchema,
    entry.messageSchema,
    entry.schemaMismatch,
    changes,
    entry.declaredSchemas,
  );
}

/**
 * A reserved topic never gets a status. For a domain topic: producers declared but nobody consumes it is a
 * deprecation candidate; consumers exist but nobody produces it AND none of those consumers are
 * HTTP-reachable is a gap. Anything else is left unflagged.
 */
function determineTopicStatus(aggregate: TopicAggregate): string | undefined {
  if (aggregate.reserved) {
    return undefined;
  }

  const hasProducers = aggregate.producers.length > 0;
  const hasConsumers = aggregate.consumers.length > 0;

  if (hasProducers && !hasConsumers) {
    return MeshTopicStatus.deprecationCandidate;
  }

  if (!hasProducers && hasConsumers && aggregate.consumers.every((c) => c.httpMappings.length === 0)) {
    return MeshTopicStatus.gap;
  }

  return undefined;
}

/**
 * Assembles one `MeshTopicEntry` from a topic's aggregate: the representative payload schemas plus the
 * cross-consumer `schemaMismatch` flag (two consumers of the same (topic, version) declaring different
 * inbound payloads is a likely contract error).
 */
function buildTopicEntry(topic: string, version: string, aggregate: TopicAggregate): MeshTopicEntry {
  const requestSchema = aggregate.consumerSchemas.map((pair) => pair.request).find((schema) => schema !== undefined);
  const responseSchema = aggregate.consumerSchemas.map((pair) => pair.response).find((schema) => schema !== undefined);

  // Only consumers that actually declared a schema are compared; Request and Response guarded independently.
  const distinctRequests = new Set(
    aggregate.consumerSchemas.filter((pair) => pair.request !== undefined).map((pair) => canonical(pair.request)),
  ).size;
  const distinctResponses = new Set(
    aggregate.consumerSchemas.filter((pair) => pair.response !== undefined).map((pair) => canonical(pair.response)),
  ).size;
  const mismatch = !aggregate.reserved && (distinctRequests > 1 || distinctResponses > 1);

  return new MeshTopicEntry(
    topic,
    version,
    aggregate.reserved,
    aggregate.consumers,
    aggregate.producers,
    determineTopicStatus(aggregate),
    requestSchema,
    responseSchema,
    aggregate.messageSchema,
    mismatch,
    [],
    mismatch ? declaredSchemasOf(aggregate) : undefined,
  );
}

/**
 * Every declaration on a topic, attributed by service — the substance behind the mismatch flag.
 *
 * Raw declarations, deliberately, rather than a diff: a diff needs a baseline, and choosing one says that
 * service is the correct one, which is precisely the judgement the reader has context for and this
 * aggregator does not (see `MeshDeclaredSchema`).
 *
 * A service that declared nothing at all on either side contributes no row — it is absent from the
 * disagreement rather than a party to it. A service that declared one side and not the other keeps its row
 * with `undefined` for the side it was silent on, because "declared no response" is a fact about that
 * service and is exactly the kind of asymmetry the flag exists to surface.
 *
 * Producers join on the same terms. The mismatch flag is defined over consumers' inbound shapes, so a
 * producer never trips it — but when a topic IS in disagreement, what the sending side declares it sends is
 * the other half of the picture, and withholding it would leave a reader comparing consumers against each
 * other with the actual message shape off-screen.
 */
function declaredSchemasOf(aggregate: TopicAggregate): MeshDeclaredSchema[] {
  const declared = aggregate.consumerSchemas
    .filter((consumer) => consumer.request !== undefined || consumer.response !== undefined)
    .map(
      (consumer) =>
        new MeshDeclaredSchema(consumer.service, MeshDeclaredSchemaRole.consumer, consumer.request, consumer.response),
    );

  declared.push(
    ...aggregate.producerSchemas
      .filter((producer) => producer.message !== undefined)
      .map(
        (producer) =>
          new MeshDeclaredSchema(producer.service, MeshDeclaredSchemaRole.producer, undefined, undefined, producer.message),
      ),
  );

  return declared;
}

// A usage entry's status counts as success when it's the synthesized "success" token or a framework
// success-class wire status; as failure when it's "failure"/"exception" or a framework failure-class wire
// status. Anything else is unclassifiable and never guessed as a failure.
function isSuccessStatus(status: string | undefined): boolean {
  return status === SuccessResult || BenzeneResultStatus.isSuccess(status);
}

function isFailureStatus(status: string | undefined): boolean {
  return status === FailureResult || status === ExceptionResult || BenzeneResultStatus.isFailure(status);
}

/**
 * Computes an edge's usage-derived req/min and error rate by summing every topic it carries. All-or-nothing:
 * if any carried topic can't be attributed unambiguously, both metrics are undefined.
 */
function attributeEdge(
  carriedTopics: string[],
  server: string,
  producersByTopic: Map<string, string[]>,
  consumersByTopic: Map<string, string[]>,
  entriesByTopic: Map<string, MeshUsageEntry[]>,
  windowMinutes: number,
): [number | undefined, number | undefined] {
  if (windowMinutes <= 0) {
    return [undefined, undefined]; // no bounded window -> no rate can be computed
  }

  let total = 0;
  let totalFailures = 0;
  let allClassifiable = true;
  for (const topic of carriedTopics) {
    const attribution = attributeTopicToEdge(topic, server, producersByTopic, consumersByTopic, entriesByTopic);
    if (attribution === undefined) {
      return [undefined, undefined]; // one ambiguous topic blanks the whole edge
    }
    total += attribution.count;
    totalFailures += attribution.failureCount;
    allClassifiable = allClassifiable && attribution.classifiable;
  }

  const requestsPerMinute = total / windowMinutes;
  const errorRate = allClassifiable && total > 0 ? totalFailures / total : undefined;
  return [requestsPerMinute, errorRate];
}

/**
 * Attributes one topic's observed traffic to the edge into `server`, or returns undefined when it can't be
 * done unambiguously. Two independent ambiguity axes: a topic with more than one producer can't be pinned to
 * a specific producer edge; and without the per-consumer `service` dimension a topic-total can only be
 * pinned to an edge when the topic has exactly one consumer.
 */
function attributeTopicToEdge(
  topic: string,
  server: string,
  producersByTopic: Map<string, string[]>,
  consumersByTopic: Map<string, string[]>,
  entriesByTopic: Map<string, MeshUsageEntry[]>,
): { count: number; classifiable: boolean; failureCount: number } | undefined {
  // (A) Producer ambiguity: a message the server handled could have come from any producer.
  const producers = producersByTopic.get(topic);
  if (producers === undefined || producers.length !== 1) {
    return undefined;
  }

  const topicEntries = entriesByTopic.get(topic) ?? [];

  // Cross-source double-count guard: one topic reported by two feeds can't be summed safely.
  if (new Set(topicEntries.map((entry) => entry.source)).size > 1) {
    return undefined;
  }

  let relevant: MeshUsageEntry[];
  if (topicEntries.some((entry) => entry.service !== undefined)) {
    // Mixed granularity within one topic (some entries consumer-scoped, some not) -> don't trust.
    if (topicEntries.some((entry) => entry.service === undefined)) {
      return undefined;
    }
    relevant = topicEntries.filter((entry) => entry.service === server);
  } else {
    // (C) Topic totals only: attributable to a specific edge only when the topic has one consumer.
    const consumers = consumersByTopic.get(topic);
    if (consumers === undefined || consumers.length !== 1) {
      return undefined;
    }
    relevant = topicEntries;
  }

  const count = relevant.reduce((sum, entry) => sum + entry.count, 0);
  // Classifiable only if every entry's outcome is known (success or a real failure).
  const classifiable = relevant.every((entry) => isSuccessStatus(entry.status) || isFailureStatus(entry.status));
  const failureCount = classifiable
    ? relevant.filter((entry) => isFailureStatus(entry.status)).reduce((sum, entry) => sum + entry.count, 0)
    : 0;
  return { count, classifiable, failureCount };
}

/** A service's health being unreachable/undeserializable is treated as `unreachable` regardless of spec. */
function determineStatus(snapshot: MeshServiceSnapshot): string {
  if (snapshot.health === undefined) {
    return MeshServiceStatus.unreachable;
  }

  return snapshot.health.isHealthy ? MeshServiceStatus.healthy : MeshServiceStatus.unhealthy;
}

/**
 * Extracts the topics from a service's `benzene` spec (its `requests` array). Best-effort: a
 * missing/unparseable spec contributes no topics, never failing the run.
 */
function parseTopics(specJson: string | undefined): ServiceTopic[] {
  const doc = tryParseSpec(specJson);
  if (doc === undefined || !isArray(doc.requests)) {
    return [];
  }

  const components = readComponents(doc);
  const topics: ServiceTopic[] = [];
  for (const request of doc.requests) {
    if (!isObject(request) || typeof request.topic !== 'string') {
      continue;
    }

    const version = typeof request.version === 'string' ? request.version : '';
    const reserved = request.reserved === true;

    const mappings: MeshTopicHttpMapping[] = [];
    if (isArray(request.httpMappings)) {
      for (const mapping of request.httpMappings) {
        if (isObject(mapping)) {
          const method = typeof mapping.method === 'string' ? mapping.method : '';
          const path = typeof mapping.path === 'string' ? mapping.path : '';
          mappings.push(new MeshTopicHttpMapping(method, path));
        }
      }
    }

    topics.push({
      topic: request.topic,
      version,
      reserved,
      httpMappings: mappings,
      requestSchema: extractSchema(request, 'request', components),
      responseSchema: extractSchema(request, 'response', components),
    });
  }

  return topics;
}

/**
 * Extracts the topics a service declares it *sends* from its `benzene` spec (the `events` array).
 * Best-effort, same posture as {@link parseTopics}.
 */
function parseOutboundTopics(specJson: string | undefined): ServiceOutboundTopic[] {
  const doc = tryParseSpec(specJson);
  if (doc === undefined || !isArray(doc.events)) {
    return [];
  }

  const components = readComponents(doc);
  const topics: ServiceOutboundTopic[] = [];
  for (const event of doc.events) {
    if (isObject(event) && typeof event.topic === 'string') {
      const version = typeof event.version === 'string' ? event.version : '';
      topics.push({ topic: event.topic, version, messageSchema: extractSchema(event, 'message', components) });
    }
  }

  return topics;
}

/**
 * Extracts the document-level `transports` field from a service's `benzene` spec. Best-effort, same posture
 * as {@link parseTopics}.
 */
function parseTransports(specJson: string | undefined): string[] {
  const doc = tryParseSpec(specJson);
  if (doc === undefined || !isArray(doc.transports)) {
    return [];
  }

  return doc.transports.filter((t): t is string => typeof t === 'string');
}

function tryParseSpec(specJson: string | undefined): JsonObject | undefined {
  if (specJson === undefined || specJson.trim().length === 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(specJson);
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Reads a service spec's `components.schemas` map (name -> schema) for `$ref` resolution. */
function readComponents(root: JsonObject): Map<string, unknown> {
  const map = new Map<string, unknown>();
  if (isObject(root.components) && isObject(root.components.schemas)) {
    for (const [name, value] of Object.entries(root.components.schemas)) {
      map.set(name, value);
    }
  }

  return map;
}

/**
 * Pulls the named child schema off a spec `requests`/`events` entry and returns it fully self-contained
 * (all `$ref`s inlined), or `undefined` when the entry carries no such schema.
 */
function extractSchema(entry: JsonObject, propertyName: string, components: Map<string, unknown>): JsonObject | undefined {
  const node = entry[propertyName];
  if (!isObject(node)) {
    return undefined;
  }

  const result = inlineSchema(node, components, new Set<string>(), 0);
  return isObject(result) ? result : undefined;
}

/**
 * Recursively inlines a schema element into a detached value: replaces each `$ref` with the referenced
 * component (tagging it with a `title` of the ref name), recurses through
 * `properties`/`items`/`additionalProperties`/`oneOf`/`allOf`/`anyOf`, and copies every other key verbatim.
 * Recursive types are cut with a `title`-only marker.
 */
function inlineSchema(node: unknown, components: Map<string, unknown>, visiting: Set<string>, depth: number): unknown {
  if (depth > MaxSchemaDepth) {
    return { type: 'object' };
  }

  if (!isObject(node)) {
    return structuredClone(node);
  }

  if (typeof node.$ref === 'string') {
    const name = refName(node.$ref);
    if (name === undefined || !components.has(name)) {
      return {};
    }

    if (visiting.has(name)) {
      return { type: 'object', title: name + ' (recursive)' };
    }

    visiting.add(name);
    const resolved = inlineSchema(components.get(name), components, visiting, depth + 1);
    visiting.delete(name);
    if (isObject(resolved) && resolved.title === undefined) {
      resolved.title = name;
    }

    return resolved;
  }

  const result: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && isObject(value)) {
      const properties: JsonObject = {};
      for (const [memberKey, memberValue] of Object.entries(value)) {
        properties[memberKey] = inlineSchema(memberValue, components, visiting, depth + 1);
      }
      result.properties = properties;
    } else if (key === 'items') {
      result.items = inlineSchema(value, components, visiting, depth + 1);
    } else if (key === 'additionalProperties' && isObject(value)) {
      result.additionalProperties = inlineSchema(value, components, visiting, depth + 1);
    } else if ((key === 'oneOf' || key === 'allOf' || key === 'anyOf') && isArray(value)) {
      // Composition keywords hold arrays of schemas - inline each branch so the schema stays self-contained.
      result[key] = value.map((branch) => inlineSchema(branch, components, visiting, depth + 1));
    } else {
      result[key] = structuredClone(value);
    }
  }

  return result;
}

function refName(reference: string | undefined): string | undefined {
  if (reference === undefined || reference.length === 0) {
    return undefined;
  }
  return reference.substring(reference.lastIndexOf('/') + 1);
}

/**
 * A stable, key-order-independent serialization of a schema node, used only to compare two consumers'
 * payloads for equality (object keys sorted; arrays kept in order). `undefined`/`null` render as the literal
 * `"null"`, distinct from an empty object.
 */
function canonical(node: unknown): string {
  if (node === undefined || node === null) {
    return 'null';
  }
  if (isArray(node)) {
    return '[' + node.map(canonical).join(',') + ']';
  }
  if (isObject(node)) {
    const keys = Object.keys(node).sort(ordinalCompare);
    let builder = '{';
    let first = true;
    for (const key of keys) {
      if (!first) {
        builder += ',';
      }
      first = false;
      builder += JSON.stringify(key) + ':' + canonical(node[key]);
    }
    return builder + '}';
  }
  return JSON.stringify(node);
}

/** Mirrors C#'s `ex.GetType().Name` - the exception's type name, never its message. */
function errorName(ex: unknown): string {
  return ex instanceof Error ? ex.name : typeof ex;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function ordinalCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Collision-free key for a (topic, version) or (client, server) pair - a value can contain the separator. */
function pairKey(a: string, b: string): string {
  return JSON.stringify([a, b]);
}

function pushInto<T>(map: Map<string, T[]>, key: string, value: T): void {
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, [value]);
  } else {
    existing.push(value);
  }
}

function distinctOrdinal(values: string[]): string[] {
  return [...new Set(values)].sort(ordinalCompare);
}

/** LINQ `.Min()` over a nullable value sequence: ignores `undefined`, returns `undefined` if all are. */
function minDefined(values: (number | undefined)[]): number | undefined {
  let min: number | undefined;
  for (const value of values) {
    if (value !== undefined && (min === undefined || value < min)) {
      min = value;
    }
  }
  return min;
}

function maxDefined(values: (number | undefined)[]): number | undefined {
  let max: number | undefined;
  for (const value of values) {
    if (value !== undefined && (max === undefined || value > max)) {
      max = value;
    }
  }
  return max;
}

/**
 * Port of Benzene.Mesh.Collector.Handlers.
 *
 * The collector's message handlers (docs/specification/mesh.md §4) - the collector is an ordinary Benzene
 * service, dogfooded like the aggregator's own handlers. The ingest handlers depend on
 * {@link MeshCollectorStore}; the five `benzene:mesh:query:*` handlers depend only on {@link IMeshFleetReadModel}, so
 * the fleet's data source is swappable (in-memory collector, or a backend-composed reader).
 *
 * Divergences from the C# original:
 * - The C# `[Message(topic)]` attribute has no TypeScript equivalent (there is no reflection/assembly-scan);
 *   the reserved topic each handler answers is published as {@link MeshCollectorTopics} for the host's
 *   container wiring, mirroring how `@benzenejs/mesh-aggregator` supplies topics at registration time.
 * - The `benzene:mesh:query:*` topic constants live here rather than in `@benzenejs/mesh-wire`'s `MeshTopics`
 *   (which predates the query surface in this snapshot); the ingest topics
 *   (`register`/`heartbeat`/`traces`/`issues`) are re-used from `MeshTopics`. Their string VALUES carry the
 *   same `benzene:` reserved marker (`BenzeneTopic.prefix`) as every other framework-owned topic.
 * - `IBenzeneResult<T>` -> `IBenzeneResultOf<T>`; `Task<...>` -> `Promise<...>`; the C# `Type[]` handler
 *   lists -> arrays of handler constructors.
 */
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import {
  MeshHeartbeat,
  MeshIssueBatch,
  MeshServiceDescriptor,
  MeshTopics,
  MeshTraceBatch,
} from '@benzenejs/mesh-wire';
import { BenzeneResult } from '@benzenejs/results';
import { IMeshFleetReadModel } from './IMeshFleetReadModel';
import { MeshCollectorStore } from './MeshCollectorStore';
import {
  Ack,
  CorrelationQuery,
  CorrelationView,
  FleetQuery,
  FleetView,
  ServiceQuery,
  ServiceView,
  TopicQuery,
  TopicSummary,
  TraceQuery,
  TraceView,
} from './Views';

/**
 * The reserved wire topics the collector's handlers answer (docs/specification/mesh.md §4). The ingest
 * topics come from `@benzenejs/mesh-wire`'s {@link MeshTopics}; the `benzene:mesh:query:*` read-model topics are
 * defined here because the wire-port snapshot predates them. A host binds each {@link MeshCollectorHandlers}
 * entry to its topic here (the TS analog of the C# `[Message]` attribute).
 */
export const MeshCollectorTopics = {
  register: MeshTopics.register,
  heartbeat: MeshTopics.heartbeat,
  traces: MeshTopics.traces,
  issues: MeshTopics.issues,

  /** Reads the whole known fleet (services, topics, recent flows). */
  queryFleet: 'benzene:mesh:query:fleet',

  /** Reads one service's detail. */
  queryService: 'benzene:mesh:query:service',

  /** Reads one topic's summary. */
  queryTopic: 'benzene:mesh:query:topic',

  /** Reads one flow's traced waterfall by trace id. */
  queryTrace: 'benzene:mesh:query:trace',

  /** Reads every flow carrying a business correlation id. */
  queryCorrelation: 'benzene:mesh:query:correlation',
} as const;

/** Ingests a service's descriptor (spec §4): re-registration replaces provider edges wholesale. */
export class RegisterMessageHandler implements IMessageHandler<MeshServiceDescriptor, Ack> {
  constructor(private readonly store: MeshCollectorStore) {}

  handleAsync(request: MeshServiceDescriptor): Promise<IBenzeneResultOf<Ack>> {
    if (request.service === undefined || request.service.length === 0) {
      return Promise.resolve(BenzeneResult.badRequest<Ack>('service is required'));
    }
    this.store.register(request);
    return Promise.resolve(BenzeneResult.ok(ack(1)));
  }
}

/** Ingests one instance's health report (spec §5). */
export class HeartbeatMessageHandler implements IMessageHandler<MeshHeartbeat, Ack> {
  constructor(private readonly store: MeshCollectorStore) {}

  handleAsync(request: MeshHeartbeat): Promise<IBenzeneResultOf<Ack>> {
    if (request.service === undefined || request.service.length === 0) {
      return Promise.resolve(BenzeneResult.badRequest<Ack>('service is required'));
    }
    this.store.heartbeat(request);
    return Promise.resolve(BenzeneResult.ok(ack(1)));
  }
}

/** Ingests a trace batch (spec §4): a batch of any size, including empty, is accepted. */
export class TracesMessageHandler implements IMessageHandler<MeshTraceBatch, Ack> {
  constructor(private readonly store: MeshCollectorStore) {}

  handleAsync(request: MeshTraceBatch): Promise<IBenzeneResultOf<Ack>> {
    return Promise.resolve(BenzeneResult.ok(ack(this.store.addEvents(request.events))));
  }
}

/**
 * Ingests an issue batch (spec §4.1): batch-level service required; a batch of any size, including empty (the
 * feed's liveness assertion), is accepted; invalid entries are skipped.
 */
export class IssuesMessageHandler implements IMessageHandler<MeshIssueBatch, Ack> {
  constructor(private readonly store: MeshCollectorStore) {}

  handleAsync(request: MeshIssueBatch): Promise<IBenzeneResultOf<Ack>> {
    if (request.service === undefined || request.service.length === 0) {
      return Promise.resolve(BenzeneResult.badRequest<Ack>('service is required'));
    }
    return Promise.resolve(BenzeneResult.ok(ack(this.store.addIssues(request))));
  }
}

/**
 * The whole known fleet in one read model. Depends on {@link IMeshFleetReadModel} so the fleet's data source
 * is swappable (in-memory collector, or a backend-composed reader).
 */
export class FleetQueryMessageHandler implements IMessageHandler<FleetQuery, FleetView> {
  constructor(private readonly readModel: IMeshFleetReadModel) {}

  async handleAsync(request: FleetQuery): Promise<IBenzeneResultOf<FleetView>> {
    // includeFlows is a cost hint (absent => true, today's behavior); planes that pay per flow lookup may
    // honor it, the in-memory ring ignores it.
    return BenzeneResult.ok(await this.readModel.fleetAsync(request.window, request.includeFlows ?? true));
  }
}

/** One service: fleet row + descriptor + per-instance heartbeat state. */
export class ServiceQueryMessageHandler implements IMessageHandler<ServiceQuery, ServiceView> {
  constructor(private readonly readModel: IMeshFleetReadModel) {}

  async handleAsync(request: ServiceQuery): Promise<IBenzeneResultOf<ServiceView>> {
    if (request.service === undefined || request.service.length === 0) {
      return BenzeneResult.badRequest<ServiceView>('service is required');
    }
    const view = await this.readModel.serviceAsync(request.service, request.window);
    return view === undefined
      ? BenzeneResult.notFound<ServiceView>(`unknown service ${request.service}`)
      : BenzeneResult.ok(view);
  }
}

/** One topic's catalog row: providers/consumers from the latest registered ServiceDescriptor's `produces`/`topics` (mesh.md §4). */
export class TopicQueryMessageHandler implements IMessageHandler<TopicQuery, TopicSummary> {
  constructor(private readonly readModel: IMeshFleetReadModel) {}

  async handleAsync(request: TopicQuery): Promise<IBenzeneResultOf<TopicSummary>> {
    if (request.topic === undefined || request.topic.length === 0) {
      return BenzeneResult.badRequest<TopicSummary>('topic is required');
    }
    const view = await this.readModel.topicAsync(request.topic, request.version, request.window);
    return view === undefined
      ? BenzeneResult.notFound<TopicSummary>(`unknown topic ${request.topic}`)
      : BenzeneResult.ok(view);
  }
}

/** One flow's events in start order -> the waterfall. */
export class TraceQueryMessageHandler implements IMessageHandler<TraceQuery, TraceView> {
  constructor(private readonly readModel: IMeshFleetReadModel) {}

  async handleAsync(request: TraceQuery): Promise<IBenzeneResultOf<TraceView>> {
    if (request.traceId === undefined || request.traceId.length === 0) {
      return BenzeneResult.badRequest<TraceView>('traceId is required');
    }
    const view = await this.readModel.traceAsync(request.traceId);
    return view === undefined
      ? BenzeneResult.notFound<TraceView>(`unknown trace ${request.traceId}`)
      : BenzeneResult.ok(view);
  }
}

/**
 * Every flow that carried a business correlation id, grouped by trace. Complements `benzene:mesh:query:trace` for
 * cross-service failure triage from a business identifier (a ticket/log correlation id) rather than a trace id.
 */
export class CorrelationQueryMessageHandler implements IMessageHandler<CorrelationQuery, CorrelationView> {
  constructor(private readonly readModel: IMeshFleetReadModel) {}

  async handleAsync(request: CorrelationQuery): Promise<IBenzeneResultOf<CorrelationView>> {
    if (request.correlationId === undefined || request.correlationId.length === 0) {
      return BenzeneResult.badRequest<CorrelationView>('correlationId is required');
    }
    const view = await this.readModel.correlationAsync(request.correlationId, request.window);
    return view === undefined
      ? BenzeneResult.notFound<CorrelationView>(`no flows for correlation ${request.correlationId}`)
      : BenzeneResult.ok(view);
  }
}

/**
 * The nine handlers to wire (the ingest quartet - register/heartbeat/traces/issues - + the five
 * `benzene:mesh:query:*` reads). The C# `[Message]` attribute has no TS equivalent, so a host binds each to its
 * {@link MeshCollectorTopics} topic during registration.
 */
export const MeshCollectorHandlers = {
  all: [
    RegisterMessageHandler,
    HeartbeatMessageHandler,
    TracesMessageHandler,
    IssuesMessageHandler,
    FleetQueryMessageHandler,
    ServiceQueryMessageHandler,
    TopicQueryMessageHandler,
    TraceQueryMessageHandler,
    CorrelationQueryMessageHandler,
  ],

  /**
   * The read-side `benzene:mesh:query:*` handlers only - no ingest (`register`/`heartbeat`/`traces`). Register these
   * when the fleet read model is composed from an external backend (a `Benzene.Mesh.Fleet.*` adapter) rather
   * than the in-memory push collector: there is no ring to ingest into, only an {@link IMeshFleetReadModel}
   * to query. These depend solely on {@link IMeshFleetReadModel}, not {@link MeshCollectorStore}.
   */
  queries: [
    FleetQueryMessageHandler,
    ServiceQueryMessageHandler,
    TopicQueryMessageHandler,
    TraceQueryMessageHandler,
    CorrelationQueryMessageHandler,
  ],
} as const;

function ack(accepted: number): Ack {
  const result = new Ack();
  result.accepted = accepted;
  return result;
}

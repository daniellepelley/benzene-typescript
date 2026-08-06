/**
 * Port of Benzene.Mesh.Collector.Views - the read-model DTOs the `mesh:query:*` handlers return
 * (the `mesh:query:fleet`/`service`/`topic`/`trace`/`correlation` responses) plus their request
 * bodies, the health vocabulary, and the time-range/window shapes (docs/specification/mesh.md §4-§6).
 *
 * C# `[JsonIgnore(WhenWritingNull)]` optional fields -> `undefined` (never `null`) so `MeshJson.serialize`
 * omits them, exactly as `@benzene/mesh-wire` does. `DateTimeOffset`/`DateTimeOffset?` -> epoch-millisecond
 * `number`/`number | undefined` (the same choice `MeshTraceEvent.startedAt` makes in the wire port).
 * `List<T>`/`Dictionary<string,long>` -> arrays / `Record<string, number>`.
 */
import { MeshIssue, MeshServiceDescriptor, MeshPlacement, MeshTraceEvent } from '@benzene/mesh-wire';

/** Health classification of a service, from its instances' latest heartbeats. */
export const MeshHealth = {
  healthy: 'healthy',
  degraded: 'degraded',
  unknown: 'unknown',
} as const;

/** The health values a service row can carry (`'healthy' | 'degraded' | 'unknown'`) — the narrowed type of the
 *  wire's `health` field. Additive DX over the wire's bare `string`; no wire change. */
export type MeshHealthValue = (typeof MeshHealth)[keyof typeof MeshHealth];

/** Acknowledges an ingest message: how many items were accepted. */
export class Ack {
  accepted = 0;
}

/** The `mesh:query:fleet` response: the whole known fleet in one shape. */
export class FleetView {
  /** Epoch milliseconds (the port of C# `DateTimeOffset GeneratedAt`). */
  generatedAt = 0;

  services: ServiceSummary[] = [];

  topics: TopicSummary[] = [];

  traces: TraceSummary[] = [];

  /**
   * The collector's merged issue map (spec §4.1), newest activity first - empty when the plane has no issue
   * feed (additive; the fixtures' subset match ignores it). Not window-filtered (a merged map, like the
   * cumulative counts): readers window on lastSeen.
   */
  issues: MeshIssue[] = [];

  /**
   * The time window this view answers, when the query carried one. Absent (`undefined`) when the query
   * carried no window - today's behavior, so old clients and fixtures see the field is not there. See
   * {@link MeshWindow} for the flows-vs-counts honesty it carries.
   */
  window?: MeshWindow;
}

/**
 * One service's fleet row. `missingFeeds` names the feeds the collector has not received for it
 * ("descriptor", "health", "traces") - reduced is visible, never mistaken for empty.
 */
export class ServiceSummary {
  service = '';

  runtime?: string;

  binding?: string;

  placement: MeshPlacement = new MeshPlacement();

  topics = 0;

  instances = 0;

  health: MeshHealthValue = MeshHealth.unknown;

  /**
   * When this service was last observed (epoch ms), or `undefined` when the plane carries no live-time
   * signal (the composite plane's anonymous rows). Absent is omitted, never a default epoch.
   */
  lastSeen?: number;

  invocations = 0;

  errors = 0;

  missingFeeds: string[] = [];
}

/**
 * One topic's catalog row: providers from descriptors, consumers observed from trace parentage, stats
 * from the trace feed - nothing is declared.
 */
export class TopicSummary {
  topic = '';

  version?: string;

  providers: string[] = [];

  consumers: string[] = [];

  invocations = 0;

  errors = 0;

  avgDurationMs = 0;

  statusCounts: Record<string, number> = {};

  /** When this topic was last observed (epoch ms), or `undefined` when the plane doesn't carry it. */
  lastSeen?: number;

  /**
   * Which stat dimensions are genuinely absent for this topic (the counts/duration are the non-nullable
   * default, not an observed zero) - the same "reduced is visible, never mistaken for empty" degradation
   * marker {@link ServiceSummary.missingFeeds} carries, at the topic grain. Empty on the push-collector
   * plane (it observes every dimension); a backend-composed reader that can't supply, e.g., duration names
   * it here so the UI renders "—" not "0".
   */
  missingFeeds: string[] = [];

  /**
   * The time window this row answers, populated only on the standalone `mesh:query:topic` response when
   * the query carried a window; omitted (`undefined`) when embedded in a {@link FleetView} (the fleet's
   * one {@link FleetView.window} covers the whole view) and when no window was requested.
   */
  window?: MeshWindow;
}

/** One recent flow on the fleet view. */
export class TraceSummary {
  traceId = '';

  events = 0;

  services: string[] = [];

  /** Epoch milliseconds (the port of C# `DateTimeOffset StartedAt`). */
  startedAt = 0;

  durationMs = 0;

  failed = false;

  /**
   * The flow's entry topic - the earliest Benzene event's topic - or `undefined` when the plane can't
   * attribute one (a summary-plane row that mapped no Benzene spans). Omitted from the wire when absent.
   */
  topic?: string;
}

/**
 * The `mesh:query:service` response: the fleet row plus the registered descriptor and per-instance
 * heartbeat state. `hashMatches` is false when an instance runs a different contract than the collector
 * knows (a redeploy it hasn't re-learned), `undefined` when either side didn't supply a hash.
 */
export class ServiceView {
  service = '';

  runtime?: string;

  binding?: string;

  placement: MeshPlacement = new MeshPlacement();

  topics = 0;

  health: MeshHealthValue = MeshHealth.unknown;

  lastSeen?: number;

  invocations = 0;

  errors = 0;

  missingFeeds: string[] = [];

  descriptor?: MeshServiceDescriptor;

  instances: InstanceView[] = [];

  /** The time window this view answers, when the query carried one; absent otherwise. */
  window?: MeshWindow;
}

/** One instance's latest heartbeat state. */
export class InstanceView {
  instanceId = '';

  healthy = false;

  /** Epoch milliseconds (the port of C# `DateTimeOffset LastHeartbeat`). */
  lastHeartbeat = 0;

  descriptorHash?: string;

  hashMatches?: boolean;
}

/** The `mesh:query:trace` response: the flow's events in start order. */
export class TraceView {
  traceId = '';

  events: MeshTraceEvent[] = [];
}

/**
 * The `mesh:query:correlation` response: every flow that carried a business correlation id, grouped by
 * trace. A correlation id is a business identifier that can span more than one trace, so this returns one
 * {@link TraceView} per matching trace rather than a single flattened event list.
 */
export class CorrelationView {
  correlationId = '';

  traces: TraceView[] = [];

  /** The time window the search covered, when the query carried one; absent otherwise. */
  window?: MeshWindow;
}

/**
 * A requested query time range, in Grafana relative-time grammar (`now`, `now-5m`, `now-1h`, `now-7d`,
 * units s/m/h/d/w/M/y) or ISO-8601 absolute. Additive and optional on the query bodies that carry it: a
 * `undefined` range (or a range with no {@link MeshTimeRange.from}) means "unfiltered" - exactly today's
 * behavior. Resolved to absolute against the server's `now` at query time ({@link MeshTimeRangeResolver}).
 */
export class MeshTimeRange {
  /** Lower bound - Grafana relative (`now-1h`) or ISO-8601 absolute. Null/empty => unfiltered. */
  from?: string;

  /** Upper bound - same grammar. Null/empty => `now`. */
  to?: string;
}

/**
 * The resolved time window a read model answers, and - crucially - whether the row *counts* honor it. The
 * {@link from}/{@link to} bounds always describe the window applied to the view's *flows* (recent-flows /
 * correlation), which every plane can filter. The counts are the subtle part: a windowed count that can't
 * honor the window is not "absent" (that is the {@link TopicSummary.missingFeeds} "—" channel) - it is a
 * real number answering a *different* window, badged "counts cover from {countsSince}", never blanked.
 * {@link countsWindowed} is the seam that flips to true once a plane's counts honor the picked window.
 */
export class MeshWindow {
  /** Resolved absolute (ISO-8601) lower bound applied to the flows in this view. */
  from = '';

  /** Resolved absolute (ISO-8601) upper bound (the server's `now` unless a `to` was given). */
  to = '';

  /** True when the row counts honor `[from,to]`; false when the counts cover a different window. */
  countsWindowed = false;

  /**
   * When {@link countsWindowed} is false, the ISO-8601 instant the row counts actually cover from;
   * `undefined` when {@link countsWindowed} is true (the counts cover {@link from}).
   */
  countsSince?: string;
}

/** The `mesh:query:fleet` request body. */
export class FleetQuery {
  /** Optional query time range (additive; undefined => unfiltered, today's behavior). */
  window?: MeshTimeRange;

  /**
   * Whether to include the recent-flows list (and, on a trace-backed plane, the anonymous service rows
   * derived from it). Additive; undefined/absent => true. Set false by a caller that only needs the
   * windowed counts - a push-collector plane reads its own in-memory ring and may ignore the hint. A cost
   * hint, never a contract change: a reader must still tolerate an empty flows list.
   */
  includeFlows?: boolean;
}

/** The `mesh:query:service` request body. */
export class ServiceQuery {
  service?: string;

  /** Optional query time range (additive; undefined => unfiltered, today's behavior). */
  window?: MeshTimeRange;
}

/** The `mesh:query:topic` request body. */
export class TopicQuery {
  topic?: string;

  version?: string;

  /** Optional query time range (additive; undefined => unfiltered, today's behavior). */
  window?: MeshTimeRange;
}

/**
 * The `mesh:query:trace` request body. Deliberately carries no window - a trace lookup is by id, and a
 * window on it would only let a valid id outside the range answer `NotFound`.
 */
export class TraceQuery {
  traceId?: string;
}

/** The `mesh:query:correlation` request body. */
export class CorrelationQuery {
  correlationId?: string;

  /** Optional query time range (additive; undefined => unfiltered, today's behavior). */
  window?: MeshTimeRange;
}

/** Port of the trace/heartbeat data shapes in Benzene.Mesh.Wire.MeshTraceEvent. */
import { HealthCheckResponse } from '@benzene/health-checks-core';

/**
 * One pipeline invocation as the mesh sees it (docs/specification/mesh.md §3) - semantic
 * (topic + Benzene status), not transport-shaped. Trace ids are the W3C Trace Context fields.
 * `DateTimeOffset StartedAt` -> epoch-millisecond `number`; optional fields are `undefined` (not
 * `null`) so `MeshJson.serialize` omits them (the C# `WhenWritingNull`).
 */
export class MeshTraceEvent {
  traceId = '';

  spanId = '';

  parentSpanId?: string;

  service?: string;

  instanceId?: string;

  topic = '';

  topicVersion?: string;

  /** The Benzene status verbatim; empty only when no downstream middleware produced a result. */
  status = '';

  /**
   * The failure's WHY (spec §3): the thrown exception's type name, stamped by the pipeline on the same
   * topic-bearing span as {@link status}. `undefined` for non-exception failures or spans predating the tag
   * (so `MeshJson.serialize` omits it - additive, no wire change for existing serialization).
   */
  exceptionType?: string;

  durationMs = 0;

  /** Epoch milliseconds (the port of C# `DateTimeOffset StartedAt`). */
  startedAt = 0;

  correlationId?: string;
}

/** The body of a `mesh:traces` message (spec §4): one exporter flush. */
export class MeshTraceBatch {
  events: MeshTraceEvent[] = [];
}

/**
 * The body of a `mesh:heartbeat` message (spec §5): the standard aggregate health response reused
 * as-is, wrapped with identity and the contract hash. `DateTimeOffset SentAt` -> epoch-ms `number`.
 */
export class MeshHeartbeat {
  service = '';

  instanceId?: string;

  descriptorHash?: string;

  /** Epoch milliseconds (the port of C# `DateTimeOffset SentAt`). */
  sentAt = 0;

  health?: HealthCheckResponse;
}

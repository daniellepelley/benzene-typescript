/** Port of Benzene.Mesh.Fleet.Jaeger.JaegerTraceMapper. */
import { MeshTraceEvent } from '@benzene/mesh-wire';

/** One trace as mapped from Jaeger: its id and the mesh events of its topic-bearing spans. */
export interface JaegerMappedTrace {
  traceId: string;
  events: MeshTraceEvent[];
}

type JsonObject = Record<string, unknown>;

/**
 * Maps a Jaeger query response (`GET /api/traces/{id}` or `/api/traces?service=...`, both of which return
 * `{ "data": [ trace, ... ] }`) into the mesh's {@link MeshTraceEvent} shape. Only spans carrying a Benzene
 * topic tag become events - a real trace mixes in transport/SDK spans the mesh view has no place for, so
 * this filters to the topic-bearing spans the pipeline stamps
 * (`Benzene.Diagnostics.ActivityMiddlewareDecorator`; see `work/otel-fleet-adapter-scope.md`).
 *
 * Jaeger's model differs from OTLP/Tempo: times are **microseconds** (`startTime`/`duration`), parentage is
 * a `references` entry with `refType == "CHILD_OF"` (not a `parentSpanId` field), and the emitting service
 * is `processes[processID].serviceName` (not a resource attribute). Benzene tag keys are read by their
 * dotted names verbatim (`benzene.topic` etc.) - Jaeger preserves tag keys, so there is no key-sanitising to
 * reconcile. Jaeger's PascalCase-free JSON keys (`traceID`/`spanID`/`startTime`/...) are read as-is off the
 * wire; the mapped `MeshTraceEvent` members are camelCase.
 *
 * `System.Text.Json.JsonDocument` -> `JSON.parse` + `unknown` type guards; `DateTimeOffset` -> epoch-ms
 * `number`. (`MeshTraceEvent.exceptionType`, from `benzene.exception.type`, IS carried - the field was added
 * to `@benzene/mesh-wire` with the X-Ray port.)
 */
export const JaegerTraceMapper = {
  /**
   * Parse a Jaeger `data[]` response into one {@link JaegerMappedTrace} per trace, each carrying its
   * topic-bearing spans in start order. A body that fails to parse yields an empty list (traces are read
   * best-effort).
   */
  mapTraces(body: string): JaegerMappedTrace[] {
    const results: JaegerMappedTrace[] = [];
    if (body.trim().length === 0) {
      return results;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return results;
    }

    if (!isObject(parsed) || !isArray(parsed.data)) {
      return results;
    }

    for (const trace of parsed.data) {
      const mapped = mapTrace(trace);
      if (mapped !== undefined) {
        results.push(mapped);
      }
    }

    return results;
  },
} as const;

function mapTrace(trace: unknown): JaegerMappedTrace | undefined {
  if (!isObject(trace)) {
    return undefined;
  }

  const traceId = getString(trace, 'traceID');
  if (traceId === undefined || traceId.length === 0 || !isArray(trace.spans)) {
    return undefined;
  }

  const services = processServiceNames(trace);
  const events: MeshTraceEvent[] = [];

  for (const span of trace.spans) {
    if (!isObject(span)) {
      continue;
    }

    const tags = readTags(span);
    const topic = tags['benzene.topic'];
    if (topic === undefined || topic.length === 0) {
      continue;
    }

    const processId = getString(span, 'processID');
    const event = new MeshTraceEvent();
    event.traceId = traceId;
    event.spanId = getString(span, 'spanID') ?? '';
    const parent = childOfParent(span);
    if (parent !== undefined) {
      event.parentSpanId = parent;
    }
    // Prefer the Benzene service name the pipeline stamps (benzene.service); fall back to Jaeger's
    // processes[processID].serviceName (correct in the common case, but the mesh's own namespace stays
    // authoritative and uniform across the trace-plane mappers).
    event.service = tags['benzene.service'] ?? (processId !== undefined ? services[processId] : undefined);
    event.topic = topic;
    event.topicVersion = tags['benzene.version'];
    event.status = tags['benzene.status'] ?? '';
    // The failure's WHY (spec §3): the thrown exception's type name (benzene.exception.type), read when
    // present; undefined for non-exception failures or spans predating the tag.
    event.exceptionType = tags['benzene.exception.type'];
    event.correlationId = tags['benzene.correlation-id'];
    event.startedAt = microsToTime(getLong(span, 'startTime'));
    event.durationMs = getLong(span, 'duration') / 1000; // µs → ms
    events.push(event);
  }

  events.sort((a, b) => a.startedAt - b.startedAt);
  return { traceId, events };
}

function processServiceNames(trace: JsonObject): Record<string, string> {
  const result: Record<string, string> = {};
  if (isObject(trace.processes)) {
    for (const [key, value] of Object.entries(trace.processes)) {
      const name = isObject(value) ? getString(value, 'serviceName') : undefined;
      if (name !== undefined && name.length > 0) {
        result[key] = name;
      }
    }
  }

  return result;
}

/** The parent span id from the first `CHILD_OF` reference, or `undefined` (a root span). */
function childOfParent(span: JsonObject): string | undefined {
  if (isArray(span.references)) {
    for (const reference of span.references) {
      if (isObject(reference) && getString(reference, 'refType') === 'CHILD_OF') {
        const parent = getString(reference, 'spanID');
        return parent === undefined || parent.length === 0 ? undefined : parent;
      }
    }
  }

  return undefined;
}

/**
 * Read a Jaeger `tags` array (`[{ "key": k, "type": t, "value": v }]`) into a key->string map, coercing
 * non-string values to text.
 */
function readTags(span: JsonObject): Record<string, string> {
  const result: Record<string, string> = {};
  if (!isArray(span.tags)) {
    return result;
  }

  for (const tag of span.tags) {
    if (!isObject(tag)) {
      continue;
    }

    const key = getString(tag, 'key');
    if (key === undefined || key.length === 0 || !('value' in tag)) {
      continue;
    }

    const value = tag.value;
    let text: string | undefined;
    if (typeof value === 'string') {
      text = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      text = String(value);
    }

    if (text !== undefined) {
      result[key] = text;
    }
  }

  return result;
}

function microsToTime(micros: number): number {
  return micros > 0 ? Math.floor(micros / 1000) : 0;
}

function getString(node: JsonObject, name: string): string | undefined {
  const value = node[name];
  return typeof value === 'string' ? value : undefined;
}

function getLong(node: JsonObject, name: string): number {
  const value = node[name];
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

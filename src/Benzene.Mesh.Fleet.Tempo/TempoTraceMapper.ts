/** Port of Benzene.Mesh.Fleet.Tempo.TempoTraceMapper. */
import { MeshTraceEvent } from '@benzene/mesh-wire';

type JsonObject = Record<string, unknown>;

/**
 * Maps Grafana Tempo's trace-by-id response (OTLP/JSON - the shape `GET /api/traces/{id}` returns with
 * `Accept: application/json`) into the mesh's {@link MeshTraceEvent} shape. Only spans carrying a Benzene
 * topic attribute become events - a real trace mixes in transport/SDK spans the mesh view has no place for,
 * so this filters to the topic-bearing spans the pipeline stamps
 * (`Benzene.Diagnostics.ActivityMiddlewareDecorator`; see `work/otel-fleet-adapter-scope.md`).
 *
 * The Benzene span attributes are read by their dotted OTLP names verbatim (`benzene.topic`,
 * `benzene.status`, `benzene.version`, `benzene.correlation-id`) - Tempo preserves attribute keys as
 * emitted, so unlike the X-Ray adapter there is no annotation/metadata key-sanitising to reconcile. The
 * emitting service is the span's `benzene.service` attribute when present, else the batch `resource`'s
 * `service.name`. Handles both the current `scopeSpans` and the legacy `instrumentationLibrarySpans` batch
 * shape.
 *
 * Divergences from the C# original:
 * - `System.Text.Json.JsonDocument` -> `JSON.parse` + `unknown` type guards; `DateTimeOffset` -> epoch-ms
 *   `number`; span times are parsed as `bigint` (unix-nano exceeds `Number.MAX_SAFE_INTEGER`) before the
 *   nanos -> ms reduction, matching C#'s `long`.
 *
 * (`MeshTraceEvent.exceptionType`, from `benzene.exception.type`, IS carried - the field was added to
 * `@benzene/mesh-wire` with the X-Ray port.)
 */
export const TempoTraceMapper = {
  /**
   * Parse a Tempo trace-by-id OTLP/JSON body and emit one {@link MeshTraceEvent} per topic-bearing span,
   * carrying the queried `meshTraceId` and ordered by start time. A body that fails to parse yields an empty
   * list (traces are read best-effort).
   */
  map(meshTraceId: string, body: string): MeshTraceEvent[] {
    const events: MeshTraceEvent[] = [];
    if (body.trim().length === 0) {
      return events;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return events;
    }

    if (!isObject(parsed) || !isArray(parsed.batches)) {
      return events;
    }

    for (const batch of parsed.batches) {
      if (!isObject(batch)) {
        continue;
      }

      const service = resourceServiceName(batch);
      for (const span of spansIn(batch)) {
        const attributes = readAttributes(span);
        const topic = attributes['benzene.topic'];
        if (topic === undefined || topic.length === 0) {
          continue;
        }

        const event = new MeshTraceEvent();
        event.traceId = meshTraceId;
        event.spanId = getString(span, 'spanId') ?? '';
        const parent = emptyToUndefined(getString(span, 'parentSpanId'));
        if (parent !== undefined) {
          event.parentSpanId = parent;
        }
        // Prefer the Benzene service name the pipeline stamps (benzene.service); fall back to the batch
        // resource's service.name (already correct in the common case, but keeping the mesh's own namespace
        // authoritative makes every trace-plane mapper uniform and backend-agnostic).
        event.service = attributes['benzene.service'] ?? service;
        event.topic = topic;
        event.topicVersion = attributes['benzene.version'];
        event.status = attributes['benzene.status'] ?? '';
        // The failure's WHY (spec §3): the thrown exception's type name (benzene.exception.type), read when
        // present; undefined for non-exception failures or spans predating the tag.
        event.exceptionType = attributes['benzene.exception.type'];
        event.correlationId = attributes['benzene.correlation-id'];
        event.startedAt = nanosToTime(getString(span, 'startTimeUnixNano'));
        event.durationMs = durationMs(span);
        events.push(event);
      }
    }

    events.sort((a, b) => a.startedAt - b.startedAt);
    return events;
  },
} as const;

function resourceServiceName(batch: JsonObject): string | undefined {
  if (isObject(batch.resource)) {
    const attributes = readAttributes(batch.resource);
    const name = attributes['service.name'];
    if (name !== undefined && name.length > 0) {
      return name;
    }
  }

  return undefined;
}

/**
 * Every span in a batch, across the current `scopeSpans` and legacy `instrumentationLibrarySpans` shapes.
 */
function spansIn(batch: JsonObject): JsonObject[] {
  const result: JsonObject[] = [];
  for (const scopeKey of ['scopeSpans', 'instrumentationLibrarySpans']) {
    const scopes = batch[scopeKey];
    if (!isArray(scopes)) {
      continue;
    }

    for (const scope of scopes) {
      if (isObject(scope) && isArray(scope.spans)) {
        for (const span of scope.spans) {
          if (isObject(span)) {
            result.push(span);
          }
        }
      }
    }
  }

  return result;
}

/**
 * Read an OTLP `attributes` array (`[{ "key": k, "value": { "stringValue": v } }]`) into a flat
 * key->string map, coercing non-string value kinds to their text form.
 */
function readAttributes(node: JsonObject): Record<string, string> {
  const result: Record<string, string> = {};
  if (!isArray(node.attributes)) {
    return result;
  }

  for (const attribute of node.attributes) {
    if (!isObject(attribute)) {
      continue;
    }

    const key = getString(attribute, 'key');
    if (key === undefined || key.length === 0 || !('value' in attribute)) {
      continue;
    }

    const text = readAnyValue(attribute.value);
    if (text !== undefined) {
      result[key] = text;
    }
  }

  return result;
}

/**
 * Read an OTLP `AnyValue` (`stringValue`/`intValue`/`boolValue`/`doubleValue`) as text. `intValue` is
 * JSON-encoded as a string per the OTLP/JSON spec; the others are JSON scalars.
 */
function readAnyValue(value: unknown): string | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  if (typeof value.stringValue === 'string') {
    return value.stringValue;
  }

  for (const key of ['intValue', 'boolValue', 'doubleValue']) {
    if (key in value) {
      const element = value[key];
      return typeof element === 'string' ? element : String(element);
    }
  }

  return undefined;
}

function durationMs(span: JsonObject): number {
  const start = parseNanos(getString(span, 'startTimeUnixNano'));
  const end = parseNanos(getString(span, 'endTimeUnixNano'));
  return end > start ? Number(end - start) / 1_000_000 : 0;
}

function nanosToTime(nanos: string | undefined): number {
  const value = parseNanos(nanos);
  return value > 0n ? Number(value / 1_000_000n) : 0;
}

// unix-nano values exceed Number.MAX_SAFE_INTEGER, so parse as bigint to keep C#'s `long` precision.
function parseNanos(raw: string | undefined): bigint {
  if (raw === undefined) {
    return 0n;
  }
  const trimmed = raw.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) {
    return 0n;
  }
  try {
    return BigInt(trimmed);
  } catch {
    return 0n;
  }
}

function getString(node: JsonObject, name: string): string | undefined {
  const value = node[name];
  return typeof value === 'string' ? value : undefined;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

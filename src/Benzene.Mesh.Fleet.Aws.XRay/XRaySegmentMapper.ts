/** Port of Benzene.Mesh.Fleet.Aws.XRay.XRaySegmentMapper. */
import { MeshTraceEvent } from '@benzenejs/mesh-wire';

type JsonObject = Record<string, unknown>;

/**
 * Maps the raw X-Ray segment documents of one trace (the JSON strings X-Ray returns from `BatchGetTraces`)
 * into the mesh's {@link MeshTraceEvent} shape. Only nodes that carry a Benzene topic attribute become
 * events - X-Ray traces mix in transport/AWS-SDK spans the mesh view has no place for, so this filters to
 * the topic-bearing spans the pipeline stamps (`Benzene.Diagnostics.ActivityMiddlewareDecorator`; see
 * `work/otel-fleet-adapter-scope.md`).
 *
 * A Benzene span's attributes may land in X-Ray as either `annotations` (keys sanitised to underscores -
 * `benzene_topic`) or `metadata` (dotted keys preserved - `benzene.topic`, possibly nested under a namespace
 * like `default`), depending on how the OTel->X-Ray exporter is configured. This reads both forms so the
 * adapter works regardless of that choice. Segment/subsegment nesting gives parentage; the enclosing
 * segment's `name` is the emitting service.
 *
 * `System.Text.Json.JsonDocument` -> `JSON.parse` + `unknown` type guards (mirroring `TempoTraceMapper`);
 * `DateTimeOffset` -> epoch-ms `number`. A document that fails to parse is skipped (X-Ray traces are read
 * best-effort), exactly as the C# catches `JsonException`.
 */
export const XRaySegmentMapper = {
  /**
   * Parse each segment document and emit one {@link MeshTraceEvent} per topic-bearing node, carrying the
   * queried `meshTraceId` and ordered by start time. A document that fails to parse is skipped rather than
   * failing the whole lookup. Returns an empty list when no node carried a Benzene topic.
   */
  map(meshTraceId: string, segmentDocuments: Iterable<string | undefined>): MeshTraceEvent[] {
    const events: MeshTraceEvent[] = [];

    for (const document of segmentDocuments) {
      if (document === undefined || document.trim().length === 0) {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(document);
      } catch {
        continue;
      }

      if (!isObject(parsed)) {
        continue;
      }

      const service = tryGetString(parsed, 'name');
      walk(meshTraceId, parsed, service, events);
    }

    events.sort((a, b) => a.startedAt - b.startedAt);
    return events;
  },
} as const;

/**
 * Recursively walk a segment/subsegment node, emitting an event for any topic-bearing node and descending
 * into its subsegments.
 */
function walk(meshTraceId: string, node: JsonObject, service: string | undefined, events: MeshTraceEvent[]): void {
  const topic = readBenzene(node, 'topic');
  if (topic !== undefined && topic.length > 0) {
    const event = new MeshTraceEvent();
    event.traceId = meshTraceId;
    event.spanId = tryGetString(node, 'id') ?? '';
    event.parentSpanId = tryGetString(node, 'parent_id');
    // Prefer the Benzene service name the pipeline stamps (benzene.service) over the X-Ray segment name: on
    // Lambda the segment is named by ADOT after the handler (e.g. "ApiGatewayLambdaHandler"), not the
    // service, so the segment name is only a fallback for a span that predates the tag.
    event.service = readBenzene(node, 'service') ?? service;
    event.topic = topic;
    event.topicVersion = readBenzene(node, 'version');
    event.status = readBenzene(node, 'status') ?? '';
    // The failure's WHY (spec §3 exceptionType): the thrown exception's type name, stamped by the pipeline
    // on the same topic-bearing span as benzene.status. Undefined for non-exception failures or spans
    // predating the tag.
    event.exceptionType = readBenzene(node, 'exception.type');
    event.correlationId = readBenzene(node, 'correlation-id') ?? readBenzene(node, 'correlationId');
    event.startedAt = readStartedAt(node);
    event.durationMs = readDurationMs(node);
    events.push(event);
  }

  const subsegments = node['subsegments'];
  if (isArray(subsegments)) {
    for (const sub of subsegments) {
      if (isObject(sub)) {
        // Keep the enclosing segment's name as the service: subsegments are the same service's internal
        // spans, not a new service boundary (which X-Ray would model as its own segment).
        walk(meshTraceId, sub, service, events);
      }
    }
  }
}

/**
 * Read a `benzene.<name>` attribute from either the node's annotations (underscore key) or its metadata
 * (dotted key, at the top level or one namespace deep).
 */
function readBenzene(node: JsonObject, name: string): string | undefined {
  const underscoreKey = 'benzene_' + name.replace(/-/g, '_').replace(/\./g, '_');
  const dottedKey = 'benzene.' + name;

  const annotations = node['annotations'];
  if (isObject(annotations)) {
    const fromAnnotation = tryReadValue(annotations, underscoreKey);
    if (fromAnnotation !== undefined) {
      return fromAnnotation;
    }
  }

  const metadata = node['metadata'];
  if (isObject(metadata)) {
    const fromMetadata = tryReadValue(metadata, dottedKey);
    if (fromMetadata !== undefined) {
      return fromMetadata;
    }

    // OTel->X-Ray nests span attributes one namespace deep (default "default").
    for (const value of Object.values(metadata)) {
      if (isObject(value)) {
        const fromNamespaced = tryReadValue(value, dottedKey);
        if (fromNamespaced !== undefined) {
          return fromNamespaced;
        }
      }
    }
  }

  return undefined;
}

/** Read a scalar property as text, coercing number/boolean kinds; `undefined` when absent or a non-scalar. */
function tryReadValue(obj: JsonObject, key: string): string | undefined {
  const value = obj[key];
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (value === true) {
    return 'true';
  }
  if (value === false) {
    return 'false';
  }
  return undefined;
}

/** X-Ray `start_time` is epoch seconds as a double (sub-second fraction preserved). */
function readStartedAt(node: JsonObject): number {
  const startSeconds = tryGetDouble(node, 'start_time');
  return startSeconds === undefined ? 0 : Math.floor(startSeconds * 1000);
}

function readDurationMs(node: JsonObject): number {
  const start = tryGetDouble(node, 'start_time');
  const end = tryGetDouble(node, 'end_time');
  return start !== undefined && end !== undefined ? (end - start) * 1000 : 0;
}

function tryGetString(node: JsonObject, name: string): string | undefined {
  const value = node[name];
  return typeof value === 'string' ? value : undefined;
}

function tryGetDouble(node: JsonObject, name: string): number | undefined {
  const value = node[name];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  // Some exporters serialise the epoch as a string; accept that too.
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

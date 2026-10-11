/** Port of Benzene.Mesh.Wire.Extensions (the trace-feed half; the descriptor half went with spec 3b). */
import { IMessageGetter } from '@benzenejs/abstractions-message-handlers';
import { IMiddlewarePipelineBuilder } from '@benzenejs/abstractions-middleware';
import { IMeshStatusReader } from './IMeshStatusReader';
import { IMeshTraceExporter } from './IMeshTraceExporter';
import { MeshServiceInfo } from './MeshServiceInfo';
import { MeshSpan, Traceparent } from './MeshSpan';
import { MeshTraceEvent } from './MeshTraceEvent';

/**
 * Observes every invocation that passes through it and hands the resulting `MeshTraceEvent` to
 * `exporter` after downstream middleware finishes (docs/specification/mesh.md §3). Wire it outermost
 * (before health-check interception) so it sees every invocation. Because the message
 * handler layer already converts a missing handler, a request conversion failure, and a handler
 * exception into results, every routed invocation produces a status - trace coverage is structural.
 *
 * An incoming W3C `traceparent` header joins the existing trace; a missing or malformed one starts a
 * fresh trace. `MeshSpan.current` carries the span across the invocation so handlers can propagate it
 * outbound. An `undefined` `exporter` is a pass-through (the trace feed is simply off), a throwing
 * exporter loses its own event and never the response, and a transport without a `statusReader`
 * records an empty status - the §6 degradation rule, end to end. C# extension method -> free function.
 */
export function useMeshTrace<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  info: MeshServiceInfo,
  exporter: IMeshTraceExporter | undefined,
  statusReader?: IMeshStatusReader<TContext>,
): IMiddlewarePipelineBuilder<TContext> {
  if (exporter === undefined) {
    return app;
  }

  return app.useFn('MeshTrace', async (context, next, resolver) => {
    const messageGetter = resolver.getService(IMessageGetter);
    const topic = messageGetter.getTopic(context);
    const headers = messageGetter.getHeaders(context);

    const parsed = Traceparent.tryParse(getHeader(headers, 'traceparent'));
    const traceId = parsed?.traceId ?? Traceparent.newId(16);
    const parentSpanId = parsed?.parentSpanId ?? '';

    const traceEvent = new MeshTraceEvent();
    traceEvent.traceId = traceId;
    traceEvent.spanId = Traceparent.newId(8);
    traceEvent.parentSpanId = parentSpanId === '' ? undefined : parentSpanId;
    traceEvent.service = info.service === '' ? undefined : info.service;
    traceEvent.instanceId = info.instanceId;
    traceEvent.topic = topic?.id ?? '';
    traceEvent.topicVersion = topic?.version ? topic.version : undefined;
    traceEvent.startedAt = Date.now();
    traceEvent.correlationId = getHeader(headers, 'x-correlation-id');

    const started = performance.now();
    const span = new MeshSpan(traceEvent.traceId, traceEvent.spanId);
    try {
      await MeshSpan.runWith(span, () => next());
    } finally {
      traceEvent.durationMs = performance.now() - started;
      traceEvent.status = statusReader?.getStatus(context) ?? '';
      try {
        exporter.export(traceEvent);
      } catch {
        // a broken exporter loses its own event, never the caller's response (spec §6)
      }
    }
  });
}

// Header keys are case-insensitive on read regardless of the envelope dictionary's casing
// (wire-contracts.md §2). A cross-language participant (e.g. a Go service whose net/http
// canonicalizes "traceparent" to "Traceparent") would otherwise be missed and its trace not joined.
function getHeader(headers: Record<string, string>, key: string): string | undefined {
  const direct = headers[key];
  if (direct !== undefined) {
    return direct;
  }
  const lower = key.toLowerCase();
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === lower) {
      return value;
    }
  }
  return undefined;
}

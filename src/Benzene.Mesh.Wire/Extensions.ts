/** Port of Benzene.Mesh.Wire.Extensions (the UseMeshDescriptor half of the descriptor path). */
import {
  IMessageGetter,
  IMessageHandlerResultSetter,
} from '@benzenejs/abstractions-message-handlers';
import { IMiddlewarePipelineBuilder } from '@benzenejs/abstractions-middleware';
import { MessageHandlerDefinition, MessageHandlerResult } from '@benzenejs/core-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import { IMeshStatusReader } from './IMeshStatusReader';
import { IMeshTraceExporter } from './IMeshTraceExporter';
import { MeshServiceDescriptor } from './MeshServiceDescriptor';
import { MeshServiceInfo } from './MeshServiceInfo';
import { MeshSpan, Traceparent } from './MeshSpan';
import { MeshTopics } from './MeshTopics';
import { MeshTraceEvent } from './MeshTraceEvent';

/**
 * Intercepts the reserved `benzene:mesh` topic (plus any `aliases`) and short-circuits with `descriptor`,
 * exactly as health-check interception works - by topic id alone, ignoring version. Not wiring this
 * in is the "descriptor endpoint withheld" deployment: every other mesh feed keeps working
 * (docs/specification/mesh.md §6). C# extension method -> free function.
 */
export function useMeshDescriptor<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  descriptor: MeshServiceDescriptor,
  ...aliases: string[]
): IMiddlewarePipelineBuilder<TContext> {
  const topics = new Set<string>(aliases);
  topics.add(MeshTopics.descriptor);

  return app.useFn('MeshDescriptor', async (context, next, resolver) => {
    const messageGetter = resolver.getService(IMessageGetter);
    const topic = messageGetter.getTopic(context);
    if (topic?.id == null || !topics.has(topic.id)) {
      await next();
      return;
    }

    const resultSetter = resolver.getService(IMessageHandlerResultSetter);
    await resultSetter.setResultAsync(
      context,
      new MessageHandlerResult(topic, MessageHandlerDefinition.empty(), BenzeneResult.ok(descriptor)),
    );
  });
}

/**
 * Observes every invocation that passes through it and hands the resulting `MeshTraceEvent` to
 * `exporter` after downstream middleware finishes (docs/specification/mesh.md §3). Wire it outermost
 * (before health-check/descriptor interception) so it sees every invocation. Because the message
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

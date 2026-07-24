import {
  context as otelContext,
  ROOT_CONTEXT,
  SpanContext,
  SpanKind,
  trace,
} from '@opentelemetry/api';
import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { BenzeneDiagnostics } from './BenzeneDiagnostics';
import { parseTraceparent } from './Correlation/Extensions';

/**
 * Adds middleware that reads the `traceparent` header (matched case-insensitively) and starts the
 * pipeline's root span with the parsed remote context as its parent, so distributed traces continue
 * across services. Falls back to a normal, parentless root span when the header is missing or fails to
 * parse. Add it as the FIRST middleware in the pipeline.
 * Port of Benzene.Diagnostics.W3CTraceContextExtensions.UseW3CTraceContext (a C# extension method -> a
 * free function).
 *
 * .NET's `ActivityContext.TryParse(traceparent, tracestate, isRemote: true)` maps to building an
 * OpenTelemetry `SpanContext` from the already-ported `parseTraceparent` and setting it as the parent
 * (`isRemote: true`, so ParentBased samplers treat it as an ingested remote trace). Deviation:
 * `tracestate` is not threaded into the parent context - `@opentelemetry/api` exposes no `TraceState`
 * constructor - but the load-bearing trace continuity (trace-id + parent-span-id) is.
 */
export function useW3CTraceContext<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
): IMiddlewarePipelineBuilder<TContext> {
  return app.useFn('W3CTraceContext', async (context, next, resolver) => {
    const headersGetter = resolver.getService(IMessageHeadersGetter) as unknown as IMessageHeadersGetter<TContext>;
    const traceparent = getHeader(headersGetter.getHeaders(context), 'traceparent');
    const parsed = parseTraceparent(traceparent);

    let parentContext = otelContext.active();
    if (parsed !== undefined) {
      const remote: SpanContext = {
        traceId: parsed.traceId,
        spanId: parsed.parentSpanId,
        traceFlags: Number.parseInt(parsed.traceFlags, 16),
        isRemote: true,
      };
      parentContext = trace.setSpanContext(ROOT_CONTEXT, remote);
    }

    const span = BenzeneDiagnostics.tracer.startSpan(
      'W3CTraceContext.Root',
      { kind: SpanKind.SERVER },
      parentContext,
    );

    try {
      await otelContext.with(trace.setSpan(otelContext.active(), span), () => next());
    } finally {
      span.end();
    }
  });
}

/** Case-insensitive header lookup over the transport's header map. */
function getHeader(headers: Record<string, string>, key: string): string | undefined {
  const lowerKey = key.toLowerCase();
  for (const [headerKey, headerValue] of Object.entries(headers)) {
    if (headerKey.toLowerCase() === lowerKey) {
      return headerValue;
    }
  }
  return undefined;
}

import { trace } from '@opentelemetry/api';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { OutboundContext } from '../OutboundContext';

/**
 * Outbound middleware that stamps the current span's W3C `traceparent`/`tracestate` onto
 * {@link OutboundContext.headers}, so the receiving service can continue the same distributed trace.
 * Port of Benzene.Clients.TraceContext.W3CTraceContextMiddleware.
 *
 * .NET's `Activity.Current` maps to `trace.getActiveSpan()`; `activity.Id` (the W3C traceparent string)
 * is built from the span context's `traceId`/`spanId`/`traceFlags`, and `activity.TraceStateString` from
 * the span context's `traceState.serialize()`. (This is the *outbound* counterpart of
 * `@benzene/diagnostics`' inbound `useW3CTraceContext`, which reads a traceparent to parent the root
 * span.)
 */
export class W3CTraceContextMiddleware implements IMiddleware<OutboundContext> {
  readonly name = 'W3CTraceContextMiddleware';

  handleAsync(context: OutboundContext, next: NextFunc): Promise<void> {
    const span = trace.getActiveSpan();
    if (span !== undefined) {
      const spanContext = span.spanContext();
      context.headers.traceparent = `00-${spanContext.traceId}-${spanContext.spanId}-${spanContext.traceFlags
        .toString(16)
        .padStart(2, '0')}`;

      const tracestate = spanContext.traceState?.serialize();
      if (tracestate !== undefined && tracestate !== '') {
        context.headers.tracestate = tracestate;
      }
    }

    return next();
  }
}

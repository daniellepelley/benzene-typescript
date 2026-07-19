/** Port of Benzene.Diagnostics.Correlation.Extensions (plus the W3C `traceparent` parsing). */
import {
  IBenzeneServiceContainer,
  ICorrelationId,
  ILogContextBuilder,
} from '@benzene/abstractions';
import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { CorrelationId } from './CorrelationId';

/**
 * Registers the per-invocation {@link CorrelationId} as a scoped service.
 * Port of C# `Extensions.AddCorrelationId(this IBenzeneServiceContainer)` (a fluent extension
 * method → free function; returns the container for chaining, mirroring the C# return value).
 */
export function addCorrelationId(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  return services.addScoped(ICorrelationId, CorrelationId);
}

/**
 * Adds the correlation id to every request's log scope (registering {@link CorrelationId} for the
 * pipeline if it is not already).
 * Port of C# `Extensions.WithCorrelationId<TContext>(this ILogContextBuilder<TContext>)`.
 */
export function withCorrelationId<TContext>(
  source: ILogContextBuilder<TContext>,
): ILogContextBuilder<TContext> {
  source.register((x) => {
    addCorrelationId(x);
  });
  return source.onRequest((resolver) => ({
    correlationId: resolver.getService(ICorrelationId).get(),
  }));
}

/**
 * Looks up the first of several candidate header keys that is present (matched case-insensitively
 * and skipping empty values), in the order given; returns `''` when none match.
 * Port of the two C# `GetHeader` overloads on `IMessageHeadersGetter<TContext>` (a single `string`
 * key or a list of keys) — collapsed into one free function taking `string | readonly string[]`,
 * since the two are distinguishable at runtime.
 */
export function getHeader<TContext>(
  source: IMessageHeadersGetter<TContext>,
  context: TContext,
  keys: string | readonly string[],
): string {
  const candidateKeys = typeof keys === 'string' ? [keys] : keys;
  const headers = source.getHeaders(context);
  for (const key of candidateKeys) {
    for (const [headerKey, headerValue] of Object.entries(headers)) {
      if (
        headerKey.toLowerCase() === key.toLowerCase() &&
        headerValue !== undefined &&
        headerValue !== null &&
        headerValue !== ''
      ) {
        return headerValue;
      }
    }
  }

  return '';
}

/**
 * The components of a parsed W3C `traceparent` header.
 * Port of the fields C# recovers via `System.Diagnostics.ActivityContext.TryParse`.
 */
export interface TraceParent {
  /** 2 hex digits (`00` today). */
  readonly version: string;
  /** 32 hex digits, not all-zero. */
  readonly traceId: string;
  /** The caller's span id — 16 hex digits, not all-zero — which becomes this hop's parent span. */
  readonly parentSpanId: string;
  /** 2 hex digits of trace flags (e.g. `01` = sampled). */
  readonly traceFlags: string;
}

const traceParentPattern = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/**
 * Parses a W3C `traceparent` header into its components, returning `undefined` (never throwing)
 * when the value is missing or malformed — the same "fall back to a new trace, don't throw"
 * contract the C# middleware relies on.
 *
 * Deviation: C# reads the trace context in `W3CTraceContextExtensions.UseW3CTraceContext`, where
 * `ActivityContext.TryParse` both validates the header and produces a `System.Diagnostics`
 * `ActivityContext` that is threaded into the ambient `Activity` tree. That distributed-tracing
 * plumbing (`Activity`/`ActivitySource`/`BenzeneDiagnostics`) is the OpenTelemetry-flavored surface
 * deferred elsewhere in the port and needs a Node tracing abstraction that does not yet exist here.
 * What is portable and load-bearing today — and what the W3C tests exercise — is the header
 * parsing/validation itself, ported faithfully: the format is
 * `version "-" trace-id "-" parent-id "-" trace-flags` with the field lengths above, and an
 * all-zero trace-id or parent-id is rejected exactly as `ActivityContext.TryParse` rejects it.
 */
export function parseTraceparent(traceparent: string | undefined): TraceParent | undefined {
  if (traceparent === undefined || traceparent === null || traceparent === '') {
    return undefined;
  }

  const match = traceParentPattern.exec(traceparent);
  if (match === null) {
    return undefined;
  }

  const [, version, traceId, parentSpanId, traceFlags] = match;
  if (/^0+$/.test(traceId) || /^0+$/.test(parentSpanId)) {
    return undefined;
  }

  return { version, traceId, parentSpanId, traceFlags };
}

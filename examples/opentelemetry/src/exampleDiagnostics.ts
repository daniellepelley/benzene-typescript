/**
 * This example's OWN tracer — the analog of the .NET example's `ExampleDiagnostics.ActivitySource`. It is
 * separate from Benzene's built-in `"Benzene"` tracer (`BenzeneDiagnostics`): the pipeline's span-per-
 * middleware comes from Benzene, while the handlers use THIS tracer to add their business child spans
 * (`Payment.Charge`, `Warehouse.*`) under the active pipeline span.
 *
 * Unlike .NET — where a `TracerProviderBuilder` must `AddSource(name)` to export a source — OpenTelemetry
 * JS exports spans from every API tracer once an SDK is registered, so there is nothing to register.
 */
import { Span, trace } from '@opentelemetry/api';

export const ExampleDiagnostics = {
  sourceName: 'benzene-otel-example',
  get tracer() {
    return trace.getTracer(ExampleDiagnostics.sourceName);
  },
};

/**
 * Runs `fn` inside a new **active** span named `name`, so any span the callback (or a service it calls)
 * starts nests underneath it. The span is always ended, even if `fn` throws — so a handler that records an
 * error on the span and rethrows still produces a well-formed error span.
 */
export function withSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
  return ExampleDiagnostics.tracer.startActiveSpan(name, async (span) => {
    try {
      return await fn(span);
    } finally {
      span.end();
    }
  });
}

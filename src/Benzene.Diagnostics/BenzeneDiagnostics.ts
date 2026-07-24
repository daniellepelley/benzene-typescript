import { Counter, Histogram, Meter, metrics, trace, Tracer } from '@opentelemetry/api';

const sourceName = 'Benzene';

/**
 * Provides the shared tracer and meter every Benzene pipeline stage reports through. Wire an
 * OpenTelemetry SDK (`@opentelemetry/sdk-node` + an exporter) to export the spans and instruments to a
 * real backend.
 * Port of Benzene.Diagnostics.BenzeneDiagnostics.
 *
 * .NET's `System.Diagnostics.ActivitySource`/`Meter` map to OpenTelemetry JS's `Tracer`/`Meter`
 * (`@opentelemetry/api`). Unlike .NET - where a `TracerProviderBuilder` opts into each source by name
 * (`AddSource`) - OpenTelemetry JS exports spans/instruments from every API tracer/meter once an SDK is
 * registered, so there is no per-source registration step and no `Benzene.OpenTelemetry` counterpart
 * package.
 *
 * Deviation from the .NET static readonly fields: the tracer, meter, and instruments are resolved lazily
 * (each access re-fetches from the global provider), so they bind to whatever provider is registered at
 * use time. OpenTelemetry JS metric instruments created before a provider is registered stay no-op,
 * whereas .NET's `MeterListener` picks up eagerly-created instruments; the getters sidestep that. The
 * global provider caches its meter and instruments by name, so repeated access is cheap.
 */
export const BenzeneDiagnostics = {
  /** The name shared by the tracer and meter. */
  sourceName,

  /** The tracer every pipeline stage starts a span on. */
  get tracer(): Tracer {
    return trace.getTracer(sourceName);
  },

  /** The meter Benzene's built-in instruments are recorded on. */
  get meter(): Meter {
    return metrics.getMeter(sourceName);
  },

  /** Count of messages processed by `useBenzeneMetrics`, tagged by topic/transport/result. */
  get messagesProcessed(): Counter {
    return metrics.getMeter(sourceName).createCounter('benzene.messages.processed');
  },

  /** Duration in milliseconds of messages processed by `useBenzeneMetrics`, tagged by topic/transport/result. */
  get messageDuration(): Histogram {
    return metrics.getMeter(sourceName).createHistogram('benzene.message.duration');
  },
};

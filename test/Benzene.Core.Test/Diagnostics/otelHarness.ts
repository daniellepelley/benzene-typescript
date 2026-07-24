import { context as otelContext, metrics, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { DataPoint, MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';

/** A MetricReader that only collects on demand (no push/interval) - the port's in-memory test reader. */
class TestMetricReader extends MetricReader {
  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * In-memory OpenTelemetry setup for the diagnostics tests: registers a span exporter and a metric reader
 * as the global providers, so spans and instruments produced by `BenzeneDiagnostics` (which resolve the
 * provider lazily at use time) are captured. Stands in for the C# tests' `ActivityListener` /
 * `MeterListener`.
 */
export class OtelHarness {
  private spanExporter = new InMemorySpanExporter();
  private tracerProvider: BasicTracerProvider | undefined;
  private meterProvider: MeterProvider | undefined;
  private reader: TestMetricReader | undefined;
  private readonly contextManager = new AsyncLocalStorageContextManager();

  start(): void {
    trace.disable();
    metrics.disable();
    otelContext.disable();

    // A real context manager (what the user's OTel SDK registers) so `context.with(...)` propagates the
    // active span across `await` - needed for `getActiveSpan()` in the enrichment middleware.
    this.contextManager.enable();
    otelContext.setGlobalContextManager(this.contextManager);

    this.spanExporter = new InMemorySpanExporter();
    this.tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(this.spanExporter)],
    });
    trace.setGlobalTracerProvider(this.tracerProvider);

    this.reader = new TestMetricReader();
    this.meterProvider = new MeterProvider({ readers: [this.reader] });
    metrics.setGlobalMeterProvider(this.meterProvider);
  }

  async stop(): Promise<void> {
    await this.tracerProvider?.shutdown();
    await this.meterProvider?.shutdown();
    this.contextManager.disable();
    trace.disable();
    metrics.disable();
    otelContext.disable();
  }

  /** Every finished span, in completion order. */
  spans(): ReadableSpan[] {
    return this.spanExporter.getFinishedSpans();
  }

  /** The one span with the given name (throws if not exactly one). */
  span(name: string): ReadableSpan {
    const matches = this.spans().filter((s) => s.name === name);
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one span named '${name}', found ${matches.length}.`);
    }
    return matches[0]!;
  }

  /** The metric data points recorded for the given instrument. */
  async metricPoints(instrumentName: string): Promise<DataPoint<number>[]> {
    const result = await this.reader!.collect();
    const points: DataPoint<number>[] = [];
    for (const scopeMetrics of result.resourceMetrics.scopeMetrics) {
      for (const metric of scopeMetrics.metrics) {
        if (metric.descriptor.name === instrumentName) {
          points.push(...(metric.dataPoints as DataPoint<number>[]));
        }
      }
    }
    return points;
  }
}

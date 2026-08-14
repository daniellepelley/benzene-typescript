/**
 * `@benzene-example/opentelemetry` — a BenzeneMessage service instrumented with `@benzenejs/diagnostics`:
 * one span per pipeline middleware (on Benzene's `"Benzene"` tracer) plus business child spans from the
 * handlers, exported through any OpenTelemetry SDK. Ported from the .NET `Benzene.Examples.OpenTelemetry`.
 * See `README.md`.
 */
export * from './exampleDiagnostics';
export * from './warehouseService';
export * from './handlers';
export * from './startUp';

export * from './TimerMiddleware';
export * from './DebugMiddlewareDecorator';
export * from './DebugMiddlewareWrapper';
export * from './Extensions';

// Distributed tracing / metrics (over @opentelemetry/api): the span-per-middleware surface, W3C trace
// context, once-per-message metrics, and log/trace enrichment.
export * from './BenzeneDiagnostics';
export * from './ActivityMiddlewareDecorator';
export * from './ActivityMiddlewareWrapper';
export * from './W3CTraceContextExtensions';
export * from './MetricsExtensions';
export * from './EnrichmentExtensions';
export * from './DependencyInjectionExtensions';

// Correlation
export * from './Correlation/CorrelationId';
export * as CorrelationExtensions from './Correlation/Extensions';

// Timers
export * from './Timers/IProcessTimer';
export * from './Timers/IProcessTimerFactory';
export * from './Timers/LoggingProcessTimer';
export * from './Timers/LoggingProcessTimerFactory';
export * from './Timers/DebugProcessTimer';
export * from './Timers/DebugTimerFactory';
export * from './Timers/CompositeProcessTimer';
export * from './Timers/CompositeProcessTimerFactory';
export * as ProcessTimerExtensions from './Timers/ProcessTimerExtensions';
export * from './Timers/ActivityProcessTimer';

// Benzene.OpenTelemetry has no counterpart package: unlike .NET (where a TracerProviderBuilder must
// AddSource/AddMeter by name), OpenTelemetry JS exports spans/instruments from every API tracer/meter
// once an SDK is registered, so there is no per-source registration step to port.

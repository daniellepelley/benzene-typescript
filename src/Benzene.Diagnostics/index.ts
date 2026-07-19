export * from './TimerMiddleware';
export * from './DebugMiddlewareDecorator';
export * from './DebugMiddlewareWrapper';
export * from './Extensions';

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

// Deferred: ActivityProcessTimer / ActivityProcessTimerFactory (Benzene.Diagnostics.Timers.ActivityProcessTimer)
// are built on System.Diagnostics.Activity distributed tracing — part of the OpenTelemetry-flavored
// tracing surface (BenzeneDiagnostics.ActivitySource, ActivityMiddleware, UseW3CTraceContext) deferred
// elsewhere in the port until a Node tracing abstraction exists. See Correlation/Extensions.ts
// (parseTraceparent) for the portable slice of the W3C trace-context handling.

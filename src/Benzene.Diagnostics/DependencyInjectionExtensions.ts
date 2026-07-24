import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { IMiddlewareWrapper } from '@benzene/abstractions-middleware';
import { ActivityMiddlewareWrapper } from './ActivityMiddlewareWrapper';
import { DebugMiddlewareWrapper } from './DebugMiddlewareWrapper';
import { ActivityProcessTimerFactory } from './Timers/ActivityProcessTimer';
import { IProcessTimerFactory } from './Timers/IProcessTimerFactory';

/**
 * Top-level DI registration for the diagnostics/tracing surface.
 * Port of Benzene.Diagnostics.DependencyInjectionExtensions (C# extension methods -> free functions).
 */

/**
 * Registers {@link ActivityMiddlewareWrapper} so every middleware in every pipeline is wrapped in its own
 * span (named after the middleware, tagged `benzene.transport`/`benzene.topic`/`benzene.version`/
 * `benzene.handler` where resolvable). The focused opt-in for per-middleware tracing without the debug
 * wrapper and timer factory that {@link addDiagnostics} also brings in. Idempotent and composes safely
 * with {@link addDiagnostics}.
 */
export function addActivityPerMiddleware(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  if (!services.isTypeRegistered(ActivityMiddlewareWrapper)) {
    services.addSingleton(ActivityMiddlewareWrapper);
    services.addSingleton(IMiddlewareWrapper, ActivityMiddlewareWrapper);
  }

  return services;
}

/**
 * Registers the broader diagnostics set: the {@link DebugMiddlewareWrapper}, per-middleware activity
 * tracing ({@link addActivityPerMiddleware}), and the span-backed {@link ActivityProcessTimerFactory} as
 * the default `IProcessTimerFactory`.
 */
export function addDiagnostics(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  if (!services.isTypeRegistered(DebugMiddlewareWrapper)) {
    services.addSingleton(DebugMiddlewareWrapper);
    services.addSingleton(IMiddlewareWrapper, DebugMiddlewareWrapper);
  }

  addActivityPerMiddleware(services);

  if (!services.isTypeRegistered(ActivityProcessTimerFactory)) {
    services.addScoped(ActivityProcessTimerFactory);
    services.addScoped(IProcessTimerFactory, ActivityProcessTimerFactory);
  }

  return services;
}

/** Port of Benzene.Diagnostics.Timers.Extensions (the `Action`-callback UseTimer overload only). */
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { OnTimer, TimerMiddleware } from './TimerMiddleware';

/**
 * Adds a {@link TimerMiddleware} that reports the elapsed pipeline time to `onTimer`.
 * Port of Benzene.Diagnostics.Timers.Extensions.UseTimer(this builder, Action&lt;TContext, long&gt;).
 *
 * The C# `UseTimer` is a fluent extension method on `IMiddlewarePipelineBuilder`. TypeScript
 * cannot add a method to the builder base class from a separate package, so this is a free
 * function taking the builder as its first argument and returning it for chaining — the same
 * shape the non-fluent extension-method convention already uses across the port (cf.
 * `useRetry` in `@benzene/resilience`).
 *
 * Deferred: the sibling C# `UseTimer(this builder, string timerName)` overload resolves an
 * `IProcessTimerFactory` from the container and belongs to the `Benzene.Diagnostics.Timers`
 * surface (Activity/process-timer tracing), which is out of scope for this slice and not ported.
 */
export function useTimer<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  onTimer: OnTimer<TContext>,
): IMiddlewarePipelineBuilder<TContext> {
  return app.use(new TimerMiddleware<TContext>(onTimer));
}

/** Port of Benzene.Diagnostics.Timers.Extensions (both `UseTimer` overloads). */
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { OnTimer, TimerMiddleware } from './TimerMiddleware';
import { IProcessTimerFactory } from './Timers/IProcessTimerFactory';

/**
 * Adds pipeline timing.
 * Port of Benzene.Diagnostics.Timers.Extensions.UseTimer.
 *
 * The C# `UseTimer` is a fluent extension method on `IMiddlewarePipelineBuilder`. TypeScript
 * cannot add a method to the builder base class from a separate package, so this is a free
 * function taking the builder as its first argument and returning it for chaining — the same
 * shape the non-fluent extension-method convention already uses across the port (cf.
 * `useRetry` in `@benzene/resilience`).
 *
 * C# overloads `UseTimer` twice; they are distinguishable at runtime here (a `string` timer name
 * vs an `onTimer` callback), so the two collapse into one function that dispatches on `typeof`:
 * - `useTimer(app, timerName)` resolves the registered {@link IProcessTimerFactory} (via
 *   `tryGetService`) and wraps `next()` in a `create`/`dispose` scope, running the pipeline
 *   unwrapped when no factory is registered — the port of `UseTimer(this app, string timerName)`.
 * - `useTimer(app, onTimer)` adds a {@link TimerMiddleware} that reports elapsed milliseconds to the
 *   callback — the port of `UseTimer(this app, Action<TContext, long> onTimer)`.
 */
export function useTimer<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  timerNameOrOnTimer: string | OnTimer<TContext>,
): IMiddlewarePipelineBuilder<TContext> {
  if (typeof timerNameOrOnTimer === 'string') {
    const timerName = timerNameOrOnTimer;
    return app.useFn(timerName, async (_context, next, resolver) => {
      const processTimerFactory = resolver.tryGetService(IProcessTimerFactory);
      if (processTimerFactory !== undefined) {
        const timer = processTimerFactory.create(timerName);
        try {
          await next();
        } finally {
          timer.dispose();
        }
      } else {
        await next();
      }
    });
  }

  return app.use(new TimerMiddleware<TContext>(timerNameOrOnTimer));
}

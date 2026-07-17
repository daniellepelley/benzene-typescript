/** Port of Benzene.Diagnostics.TimerMiddleware. */
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';

/**
 * The timer callback shape. Port of C# `Action<TContext, long> onTimer`; the C# `long`
 * elapsed-milliseconds value becomes a `number`.
 */
export type OnTimer<TContext> = (context: TContext, elapsedMs: number) => void;

/**
 * Times the rest of the pipeline and reports the elapsed milliseconds via `onTimer`,
 * which always fires in a `finally` so the timing is recorded even when the pipeline throws.
 * Port of Benzene.Diagnostics.TimerMiddleware&lt;TContext&gt;.
 *
 * Deviation: C# uses `System.Diagnostics.Stopwatch` and reports
 * `Stopwatch.ElapsedMilliseconds` (an integer count of whole milliseconds). TypeScript has no
 * `Stopwatch`, so elapsed time is measured as the delta between two `Date.now()` readings
 * (also whole milliseconds), preserving the same `number` shape and semantics.
 */
export class TimerMiddleware<TContext> implements IMiddleware<TContext> {
  constructor(private readonly onTimer: OnTimer<TContext>) {}

  readonly name = 'Timer';

  async handleAsync(context: TContext, next: NextFunc): Promise<void> {
    const start = Date.now();
    try {
      await next();
    } finally {
      const elapsedMs = Date.now() - start;
      this.onTimer(context, elapsedMs);
    }
  }
}

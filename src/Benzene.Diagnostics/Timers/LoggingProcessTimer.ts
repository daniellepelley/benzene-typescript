/** Port of Benzene.Diagnostics.Timers.LoggingProcessTimer. */
import { ILogger, LogLevel } from '@benzene/abstractions';
import { IProcessTimer } from './IProcessTimer';

/**
 * An {@link IProcessTimer} that logs a "started" line on construction and a "took Nms to complete"
 * line (with any tags) on {@link dispose}.
 * Port of Benzene.Diagnostics.Timers.LoggingProcessTimer.
 *
 * Deviations:
 * - C# times with `System.Diagnostics.Stopwatch` and reports `Stopwatch.ElapsedMilliseconds`
 *   (whole-millisecond integer). TypeScript has no `Stopwatch`, so elapsed time is the delta of two
 *   `Date.now()` readings — the same mapping `TimerMiddleware` already uses.
 * - C# logs through structured message templates (`"{timer} started"` with the value passed as an
 *   arg), which the logging provider renders. The ported {@link ILogger.log} takes an
 *   already-rendered string, so the templates are formatted here directly; the resulting text
 *   (`"my-timer started"`, `"my-timer took 3ms to complete. Tags = status:ok"`) matches what the
 *   C# `FakeLogger` renders and what the tests assert.
 */
export class LoggingProcessTimer implements IProcessTimer {
  private readonly logLevel: LogLevel = LogLevel.Trace;
  private readonly startedAt: number;
  private readonly tags = new Map<string, string>();

  constructor(
    private readonly timerName: string,
    private readonly logger: ILogger,
  ) {
    this.logger.log(this.logLevel, `${this.timerName} started`);
    this.startedAt = Date.now();
  }

  dispose(): void {
    const time = Date.now() - this.startedAt;
    if (this.tags.size > 0) {
      const renderedTags = [...this.tags.entries()].map(([key, value]) => `${key}:${value}`).join(', ');
      this.logger.log(this.logLevel, `${this.timerName} took ${time}ms to complete. Tags = ${renderedTags}`);
    } else {
      this.logger.log(this.logLevel, `${this.timerName} took ${time}ms to complete`);
    }
  }

  setTag(key: string, value: string): void {
    this.tags.set(key, value);
  }
}

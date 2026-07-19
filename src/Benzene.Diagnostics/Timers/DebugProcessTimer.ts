/** Port of Benzene.Diagnostics.Timers.DebugProcessTimer. */
import { DebugSink } from '../DebugMiddlewareDecorator';
import { IProcessTimer } from './IProcessTimer';

/** A no-op debug sink — the default, mirroring `Debug.WriteLine`'s silent-by-default behavior. */
const noopSink: DebugSink = () => {};

/**
 * An {@link IProcessTimer} that writes "started" / "took Nms to complete" / "tagged as key:value"
 * debug lines around a timed scope.
 * Port of Benzene.Diagnostics.Timers.DebugProcessTimer.
 *
 * Deviations:
 * - C# writes to `System.Diagnostics.Debug.WriteLine`. Node has no such ambient debug channel, so
 *   output is routed to an injectable {@link DebugSink} (the same type {@link DebugMiddlewareDecorator}
 *   uses), defaulting to a no-op to match `Debug.WriteLine` being silent unless a listener is attached.
 * - `System.Diagnostics.Stopwatch` → `Date.now()` deltas (whole milliseconds), as elsewhere.
 */
export class DebugProcessTimer implements IProcessTimer {
  private readonly startedAt: number;

  constructor(
    private readonly timerName: string,
    private readonly sink: DebugSink = noopSink,
  ) {
    this.sink(`${this.timerName} started`);
    this.startedAt = Date.now();
  }

  dispose(): void {
    const time = Date.now() - this.startedAt;
    this.sink(`${this.timerName} took ${time}ms to complete`);
  }

  setTag(key: string, value: string): void {
    this.sink(`${this.timerName} tagged as ${key}:${value}`);
  }
}

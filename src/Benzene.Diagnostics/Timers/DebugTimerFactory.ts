/** Port of Benzene.Diagnostics.Timers.DebugTimerFactory. */
import { DebugSink } from '../DebugMiddlewareDecorator';
import { IProcessTimer } from './IProcessTimer';
import { IProcessTimerFactory } from './IProcessTimerFactory';
import { DebugProcessTimer } from './DebugProcessTimer';

/**
 * Creates {@link DebugProcessTimer} instances.
 * Port of Benzene.Diagnostics.Timers.DebugTimerFactory.
 *
 * Deviation: C# `DebugProcessTimer` writes straight to `Debug.WriteLine`; the port threads an
 * optional {@link DebugSink} through the factory so the substitute sink can be supplied (and
 * observed in tests). Defaults to the same silent no-op the timer uses.
 */
export class DebugTimerFactory implements IProcessTimerFactory {
  constructor(private readonly sink?: DebugSink) {}

  create(timerName: string): IProcessTimer {
    return new DebugProcessTimer(timerName, this.sink);
  }
}

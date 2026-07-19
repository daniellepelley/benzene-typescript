/** Port of Benzene.Diagnostics.Timers.CompositeProcessTimerFactory. */
import { IProcessTimer } from './IProcessTimer';
import { IProcessTimerFactory } from './IProcessTimerFactory';
import { CompositeProcessTimer } from './CompositeProcessTimer';

/**
 * Creates a {@link CompositeProcessTimer} by asking every inner factory to create a timer for the
 * same name.
 * Port of Benzene.Diagnostics.Timers.CompositeProcessTimerFactory (C# `params IProcessTimerFactory[]`
 * → a rest parameter).
 */
export class CompositeProcessTimerFactory implements IProcessTimerFactory {
  private readonly processTimerFactories: IProcessTimerFactory[];

  constructor(...processTimerFactories: IProcessTimerFactory[]) {
    this.processTimerFactories = processTimerFactories;
  }

  create(timerName: string): IProcessTimer {
    return new CompositeProcessTimer(this.processTimerFactories.map((x) => x.create(timerName)));
  }
}

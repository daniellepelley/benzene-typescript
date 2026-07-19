/** Port of Benzene.Diagnostics.Timers.IProcessTimerFactory. */
import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { IProcessTimer } from './IProcessTimer';

/**
 * Creates {@link IProcessTimer} instances for a named scope. Resolved from the container by
 * `useTimer(app, timerName)`, hence the merged {@link ServiceToken}.
 * Port of Benzene.Diagnostics.Timers.IProcessTimerFactory.
 */
export interface IProcessTimerFactory {
  /** Port of C# `IProcessTimer Create(string timerName)`. */
  create(timerName: string): IProcessTimer;
}

export const IProcessTimerFactory: ServiceToken<IProcessTimerFactory> =
  serviceToken<IProcessTimerFactory>('IProcessTimerFactory');

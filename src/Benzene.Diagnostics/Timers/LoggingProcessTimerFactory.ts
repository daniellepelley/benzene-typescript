/** Port of Benzene.Diagnostics.Timers.LoggingProcessTimerFactory. */
import { ILogger } from '@benzene/abstractions';
import { IProcessTimer } from './IProcessTimer';
import { IProcessTimerFactory } from './IProcessTimerFactory';
import { LoggingProcessTimer } from './LoggingProcessTimer';

/**
 * Creates {@link LoggingProcessTimer} instances that all log through one injected {@link ILogger}.
 * Port of Benzene.Diagnostics.Timers.LoggingProcessTimerFactory.
 *
 * Deviation: C# injects the category logger `ILogger<LoggingProcessTimer>`; TypeScript has no
 * generic category-logger token, so the factory takes a plain {@link ILogger} and (for container
 * resolution) declares `inject = [ILogger]`.
 */
export class LoggingProcessTimerFactory implements IProcessTimerFactory {
  static readonly inject = [ILogger] as const;

  constructor(private readonly logger: ILogger) {}

  create(timerName: string): IProcessTimer {
    return new LoggingProcessTimer(timerName, this.logger);
  }
}

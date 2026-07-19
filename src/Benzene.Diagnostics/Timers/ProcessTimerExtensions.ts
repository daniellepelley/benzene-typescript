/** Port of Benzene.Diagnostics.Timers.ProcessTimerExtensions. */
import { IProcessTimerFactory } from './IProcessTimerFactory';

/**
 * Times a synchronous callback within a named timer scope, disposing the timer once it returns.
 * Port of C# `ProcessTimerExtensions.TimeMethod<T>` (a fluent extension method → free function
 * taking the factory as its first argument; C# `using (...)` → `try/finally` with `dispose()`).
 */
export function timeMethod<T>(
  source: IProcessTimerFactory,
  timerName: string,
  func: () => T,
): T {
  const timer = source.create(timerName);
  try {
    return func();
  } finally {
    timer.dispose();
  }
}

/**
 * Times an asynchronous callback within a named timer scope, disposing the timer once it settles.
 * Port of C# `ProcessTimerExtensions.TimeMethodAsync<T>` (`Task<T>` → `Promise<T>`).
 */
export async function timeMethodAsync<T>(
  source: IProcessTimerFactory,
  timerName: string,
  func: () => Promise<T>,
): Promise<T> {
  const timer = source.create(timerName);
  try {
    return await func();
  } finally {
    timer.dispose();
  }
}

/** Port of Benzene.Diagnostics.Timers.IProcessTimer. */

/**
 * A scoped, named timer: it starts on creation and is stopped/reported when disposed, and may
 * carry key/value tags describing what it measured.
 * Port of Benzene.Diagnostics.Timers.IProcessTimer (C# `IProcessTimer : IDisposable`).
 *
 * Deviation: C# `IDisposable.Dispose()` maps to a `dispose()` method, called via `try/finally`
 * where C# uses `using`.
 */
export interface IProcessTimer {
  /** Attaches a tag to the timed scope. Port of C# `void SetTag(string key, string value)`. */
  setTag(key: string, value: string): void;

  /** Stops the timer and reports the elapsed time. Port of C# `IDisposable.Dispose()`. */
  dispose(): void;
}

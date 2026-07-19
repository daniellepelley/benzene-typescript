/** Port of Benzene.Diagnostics.Timers.CompositeProcessTimer. */
import { IProcessTimer } from './IProcessTimer';

/**
 * An {@link IProcessTimer} that fans {@link setTag} and {@link dispose} out to several inner timers,
 * so one timed scope can report through multiple backends at once.
 * Port of Benzene.Diagnostics.Timers.CompositeProcessTimer (C# `IEnumerable<IProcessTimer>` →
 * an array, materialized in the constructor exactly as C# does with `.ToArray()`).
 */
export class CompositeProcessTimer implements IProcessTimer {
  private readonly scopes: IProcessTimer[];

  constructor(scopes: Iterable<IProcessTimer>) {
    this.scopes = [...scopes];
  }

  dispose(): void {
    for (const scope of this.scopes) {
      scope.dispose();
    }
  }

  setTag(key: string, value: string): void {
    for (const scope of this.scopes) {
      scope.setTag(key, value);
    }
  }
}

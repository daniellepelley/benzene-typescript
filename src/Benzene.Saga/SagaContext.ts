/**
 * Carries the results of completed saga steps so that a later stage can read what an earlier stage
 * produced (e.g. a stage-2 step using the tenant id a stage-1 step created). A succeeded step publishes
 * its result here after its stage completes.
 * Port of Benzene.Saga.SagaContext.
 *
 * Divergence from the .NET original: C# keys values by their reified type (`typeof(T).FullName`) with an
 * optional explicit string override. TypeScript erases generics, and `get<T>()` has no instance to fall
 * back to, so the type-as-default-key cannot be ported. This port keys strictly by an **explicit string
 * key** - a step publishes only when it declares a key (see `StepBuilder.key`), and a later stage reads
 * it by that same key. `T` is a compile-time cast only.
 *
 * Steps within a single stage run concurrently but only ever *read* earlier stages' values during that
 * concurrent phase; writes happen single-threaded after each stage's barrier, so no synchronization is
 * required here.
 */
export class SagaContext {
  private readonly items = new Map<string, unknown>();

  /** Stores `value` under `key`. */
  set<T>(key: string, value: T): void {
    this.items.set(key, value);
  }

  /**
   * Gets a previously stored value.
   * @throws Error if no value is stored for `key`.
   */
  get<T>(key: string): T {
    if (!this.items.has(key)) {
      throw new Error(`No saga context value for '${key}'.`);
    }

    return this.items.get(key) as T;
  }

  /** Attempts to get a previously stored value, returning `undefined` if absent. */
  tryGet<T>(key: string): T | undefined {
    return this.items.has(key) ? (this.items.get(key) as T) : undefined;
  }

  /** Returns whether a value is stored for `key`. */
  has(key: string): boolean {
    return this.items.has(key);
  }
}

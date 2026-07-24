/**
 * Runs a batch of per-record work concurrently with an optional ceiling on how many run at once. The
 * shared primitive behind every fan-out's opt-in `maxDegreeOfParallelism` knob: with no ceiling it
 * behaves exactly like the plain `Promise.all(items.map(body))` pattern it replaces (every record starts
 * at once), and with a ceiling it caps concurrent execution so a large batch can't start hundreds of
 * pipeline runs - and hundreds of scoped downstream resources - simultaneously.
 * Port of Benzene.Core.Middleware.BoundedFanOut.
 *
 * Results are returned in source order regardless of completion order. Semantics otherwise match
 * `Promise.all`: every record's promise is awaited, and a rejected one surfaces (the still-running
 * records continue, exactly as with C#'s `Task.WhenAll` - `SemaphoreSlim` maps to the async semaphore
 * below).
 */
export const BoundedFanOut = {
  /**
   * Projects each element of `source` through `body` concurrently, capping concurrency at
   * `maxDegreeOfParallelism`, and returns the results in source order.
   * @param maxDegreeOfParallelism The maximum number of records processed at once. `undefined` or any
   * value <= 0 means unbounded (every record starts at once) - the default, behavior-preserving mode.
   */
  async whenAllAsync<TSource, TResult>(
    source: Iterable<TSource>,
    body: (item: TSource) => Promise<TResult>,
    maxDegreeOfParallelism: number | undefined,
  ): Promise<TResult[]> {
    const items = [...source];
    if (!BoundedFanOut.isBounded(maxDegreeOfParallelism)) {
      return Promise.all(items.map(body));
    }

    // All promises are created up front (source order) and each awaits a permit before running `body`,
    // so at most `maxDegreeOfParallelism` bodies run at once yet every record is still processed.
    const semaphore = new AsyncSemaphore(maxDegreeOfParallelism as number);
    const tasks = items.map(async (item) => {
      await semaphore.acquire();
      try {
        return await body(item);
      } finally {
        semaphore.release();
      }
    });

    return Promise.all(tasks);
  },

  /** Whether a configured degree-of-parallelism actually bounds anything (a positive value). */
  isBounded(maxDegreeOfParallelism: number | undefined): boolean {
    return maxDegreeOfParallelism !== undefined && maxDegreeOfParallelism > 0;
  },
};

/** A minimal async counting semaphore - the port of the `SemaphoreSlim` gate `BoundedFanOut` uses. */
class AsyncSemaphore {
  private permits: number;
  private readonly waiters: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      // Hand the permit straight to the next waiter rather than incrementing then re-decrementing.
      waiter();
    } else {
      this.permits += 1;
    }
  }
}

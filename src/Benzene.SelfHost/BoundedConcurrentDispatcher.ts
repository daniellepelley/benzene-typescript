import { ILogger } from '@benzene/abstractions';
import { BoundedChannel } from './BoundedChannel';

/** The async handler each dispatched item is passed to. Port of C# `Func<T, CancellationToken, Task>`. */
export type DispatchHandler<T> = (item: T, cancellationToken?: AbortSignal) => Promise<void>;

/** Optional configuration for {@link BoundedConcurrentDispatcher}. Ports the C# constructor's optional parameters. */
export interface BoundedConcurrentDispatcherOptions<T> {
  /**
   * When provided, routes items sharing the same key to the same lane, preserving per-key order. When
   * omitted (the default), items round-robin across lanes with no ordering guarantee.
   */
  keySelector?: (item: T) => number;
  /**
   * When `true` (the default), a fault from `handle` is logged and swallowed - that lane keeps
   * consuming. When `false`, the fault is logged, passed to `onFault` if supplied, and rethrown -
   * ending that lane's consume loop.
   */
  catchExceptions?: boolean;
  /**
   * Invoked with the fault when `catchExceptions` is `false` and `handle` throws, before the fault is
   * rethrown. Lets a caller react to a lane dying (e.g. stop the whole worker).
   */
  onFault?: (error: unknown) => void;
}

/**
 * Dispatches items pulled from a self-hosted worker's poll loop to an async handler, bounding how many
 * handlers run at once. Built on a capacity-1 {@link BoundedChannel} per lane - the port's stand-in
 * for `System.Threading.Channels`.
 * Port of Benzene.SelfHost.BoundedConcurrentDispatcher&lt;T&gt;.
 *
 * Runs `laneCount` independent lanes, each a single-consumer channel with one dedicated consumer. With
 * a `keySelector`, items sharing a key always route to the same lane, so that lane's strictly-FIFO
 * consumer preserves order for that key while different keys run concurrently, up to `laneCount` at
 * once. Without one, items round-robin with no ordering promise. Each lane's channel has capacity 1, so
 * `enqueueAsync` blocks once a lane already has one item queued behind the one in flight - the poll
 * loop's backpressure.
 *
 * Node is single-threaded, so C#'s `Interlocked`/`Volatile` accesses on the outstanding-count array and
 * round-robin counter become plain reads/writes (only ever touched between `await` points on one event
 * loop); C#'s `ILogger` maps to `@benzene/abstractions`' `ILogger`.
 */
export class BoundedConcurrentDispatcher<T> {
  private readonly lanes: BoundedChannel<T>[];
  private readonly consumers: Promise<void>[];
  private readonly keySelector?: (item: T) => number;
  private readonly laneOutstanding: number[];
  private roundRobinCounter = -1;

  constructor(
    laneCount: number,
    handle: DispatchHandler<T>,
    private readonly logger: ILogger,
    options: BoundedConcurrentDispatcherOptions<T> = {},
  ) {
    if (laneCount < 1) {
      throw new RangeError(`laneCount must be at least 1 (was ${laneCount}).`);
    }

    this.keySelector = options.keySelector;
    const catchExceptions = options.catchExceptions ?? true;
    this.lanes = Array.from({ length: laneCount }, () => new BoundedChannel<T>());
    this.laneOutstanding = new Array<number>(laneCount).fill(0);
    this.consumers = this.lanes.map((_, i) => {
      const consumer = this.consumeLoopAsync(i, handle, catchExceptions, options.onFault);
      // A lane consumer rejects when catchExceptions=false and its handler faults. Observe it here so
      // the rejection is never "unhandled" before drainAsync awaits it (drainAsync uses allSettled, so
      // it never surfaces as a throw either - matching C#'s `Task.WhenAny`, which ignores a faulted task).
      void consumer.catch(() => {});
      return consumer;
    });
  }

  /** The number of lanes items are dispatched across. */
  get laneCount(): number {
    return this.lanes.length;
  }

  /** Maps a key to the lane index it routes to (the same mapping {@link enqueueAsync} uses). */
  laneForKey(key: number): number {
    // `>>> 0` reinterprets as uint32, matching C#'s `(uint)key % (uint)laneCount` for negative keys.
    return (key >>> 0) % this.lanes.length;
  }

  /**
   * Routes `item` to a lane (by key, if a key selector was supplied, otherwise round-robin) and
   * enqueues it for that lane's consumer to dispatch.
   */
  async enqueueAsync(item: T, cancellationToken?: AbortSignal): Promise<void> {
    const laneIndex =
      this.keySelector !== undefined
        ? (this.keySelector(item) >>> 0) % this.lanes.length
        : (++this.roundRobinCounter >>> 0) % this.lanes.length;

    // Count the item as outstanding for its lane from the moment it's accepted (queued or in flight)
    // until its handler finishes - this is what drainLanesAsync waits on. If the write is
    // cancelled/faulted it never entered the lane, so undo the increment.
    this.laneOutstanding[laneIndex]++;
    try {
      await this.lanes[laneIndex]!.write(item, cancellationToken);
    } catch (ex) {
      this.laneOutstanding[laneIndex]--;
      throw ex;
    }
  }

  /**
   * Waits for the lanes the given keys route to (via {@link laneForKey}) to have no items queued or in
   * flight, up to `timeoutMs` - without completing them, so those lanes keep consuming afterwards.
   * Because lanes are shared (`key % laneCount`), this may also wait on unrelated keys that share a
   * lane - safe, just conservative.
   */
  async drainLanesAsync(laneKeys: Iterable<number>, timeoutMs: number): Promise<void> {
    const targetLanes = [...new Set([...laneKeys].map((k) => this.laneForKey(k)))];
    if (targetLanes.length === 0) {
      return;
    }

    const start = Date.now();
    while (targetLanes.some((i) => this.laneOutstanding[i]! > 0)) {
      if (Date.now() - start >= timeoutMs) {
        return;
      }
      await delay(10);
    }
  }

  /**
   * Stops accepting new items on every lane and waits for all in-flight handler calls to finish, up to
   * `drainTimeoutMs`. Lanes that haven't finished by the timeout are abandoned, not cancelled - `handle`
   * is responsible for honoring its own cancellation, if any.
   */
  async drainAsync(drainTimeoutMs: number): Promise<void> {
    for (const lane of this.lanes) {
      lane.complete();
    }
    // allSettled (not all) so a faulted lane consumer doesn't make drain reject - C#'s `Task.WhenAny`
    // returns the faulted task without observing it; the equivalent here is to wait on settlement.
    await Promise.race([Promise.allSettled(this.consumers), delay(drainTimeoutMs)]);
  }

  private async consumeLoopAsync(
    laneIndex: number,
    handle: DispatchHandler<T>,
    catchExceptions: boolean,
    onFault: ((error: unknown) => void) | undefined,
  ): Promise<void> {
    try {
      await this.consumeLaneAsync(laneIndex, handle, catchExceptions, onFault);
    } finally {
      // The lane consumer is exiting - either normal completion (the count is already 0) or a rethrown
      // fault with catchExceptions=false. On the fault path any item still queued in this lane's
      // channel was counted at enqueue and will never be read now, so clear the phantom count -
      // otherwise a later drainLanesAsync on this lane would burn its full timeout every time.
      this.laneOutstanding[laneIndex] = 0;
    }
  }

  private async consumeLaneAsync(
    laneIndex: number,
    handle: DispatchHandler<T>,
    catchExceptions: boolean,
    onFault: ((error: unknown) => void) | undefined,
  ): Promise<void> {
    for await (const item of this.lanes[laneIndex]!.readAll()) {
      try {
        await handle(item);
      } catch (ex) {
        this.logger.logError(ex, 'Unhandled exception processing item in Benzene worker loop');

        if (!catchExceptions) {
          onFault?.(ex);
          throw ex;
        }
      } finally {
        // Runs on every path - success, swallowed exception, and the rethrow above - so each item is
        // un-counted exactly once and a quiescing drainLanesAsync never hangs on a dying lane.
        this.laneOutstanding[laneIndex]--;
      }
    }
  }
}

/** A cancellable delay. `Task.Delay(TimeSpan)` -> a `setTimeout`-backed promise. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

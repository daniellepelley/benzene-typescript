/**
 * A bounded, capacity-1, single-reader / multi-writer async channel - the subset of
 * `System.Threading.Channels.Channel<T>` (created via `Channel.CreateBounded<T>(new
 * BoundedChannelOptions(1) { SingleReader = true, SingleWriter = false, FullMode = Wait })`) that
 * {@link BoundedConcurrentDispatcher} relies on. .NET ships Channels in the BCL; Node has no
 * equivalent, so the used behaviour is re-created here (same pattern as `@benzene/rate-limiting`
 * re-creating the `System.Threading.RateLimiting` subset).
 *
 * `write` resolves once the single slot is free (giving the producer backpressure); `complete` closes
 * the channel so a pending/next `write` rejects and the `readAll` iterator finishes once drained. Node
 * is single-threaded, so no locking is needed - the fields are only ever touched between `await`
 * points on one event loop.
 */

/** Thrown by {@link BoundedChannel.write} when the channel has been completed. Port of `ChannelClosedException`. */
export class ChannelCompletedError extends Error {
  constructor() {
    super('The channel has been completed and cannot accept further writes.');
    this.name = 'ChannelCompletedError';
  }
}

export class BoundedChannel<T> {
  private slot: T | undefined;
  private hasItem = false;
  private completed = false;
  private readonly readWaiters: Array<() => void> = [];
  private readonly writeWaiters: Array<() => void> = [];

  /**
   * Writes an item, waiting while the single slot is occupied (capacity-1 backpressure). Rejects with
   * {@link ChannelCompletedError} if the channel is (or becomes) completed, or with the signal's reason
   * if `signal` aborts while waiting.
   */
  async write(item: T, signal?: AbortSignal): Promise<void> {
    while (this.hasItem && !this.completed) {
      await this.wait(this.writeWaiters, signal);
    }
    if (this.completed) {
      throw new ChannelCompletedError();
    }
    this.slot = item;
    this.hasItem = true;
    this.wake(this.readWaiters);
  }

  /** Closes the channel: no further items are accepted, and `readAll` ends once the current item (if any) is read. */
  complete(): void {
    this.completed = true;
    this.wake(this.readWaiters);
    this.wake(this.writeWaiters);
  }

  /** The single consumer's loop: yields each written item in order, returning when completed and drained. */
  async *readAll(): AsyncIterableIterator<T> {
    for (;;) {
      while (!this.hasItem && !this.completed) {
        await this.wait(this.readWaiters);
      }
      if (this.hasItem) {
        const item = this.slot as T;
        this.slot = undefined;
        this.hasItem = false;
        this.wake(this.writeWaiters);
        yield item;
      } else {
        return; // completed and empty
      }
    }
  }

  private wait(waiters: Array<() => void>, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const onResolve = (): void => {
        cleanup();
        resolve();
      };
      const onAbort = (): void => {
        const index = waiters.indexOf(onResolve);
        if (index >= 0) {
          waiters.splice(index, 1);
        }
        cleanup();
        reject(signal?.reason);
      };
      const cleanup = (): void => signal?.removeEventListener('abort', onAbort);
      waiters.push(onResolve);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * Wakes every waiter; each re-checks its own condition on resume (a freed slot only lets one writer
   * proceed, the rest re-wait), so spurious wake-ups are harmless.
   */
  private wake(waiters: Array<() => void>): void {
    const pending = waiters.splice(0);
    for (const resolve of pending) {
      resolve();
    }
  }
}

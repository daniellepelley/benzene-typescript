/** Port of Benzene.Cache.Core.CacheInvalidateActions. */
import { IBenzeneResult, ILogger } from '@benzene/abstractions';
import { ICacheInvalidateActions } from './ICacheInvalidateActions';

/**
 * Abstract base for invalidate-only cache actions. Subclasses supply the concrete backend hook
 * ({@link invalidateEntryAsync}) plus a {@link logger} and {@link keyDescription}.
 * Port of Benzene.Cache.Core.CacheInvalidateActions.
 *
 * Adaptation: the C# base also declares an abstract `IProcessTimerFactory ProcessTimerFactory`
 * and wraps the write-through in a `ProcessTimerFactory.Create(...)` timing scope. Benzene's
 * process-timer surface is deferred in the TypeScript port (see the README roadmap), so the timing
 * scope and its `SetTag` observability calls are dropped here; the control flow is otherwise
 * identical. C# abstract properties → abstract getters.
 */
export abstract class CacheInvalidateActions implements ICacheInvalidateActions {
  protected abstract get logger(): ILogger;
  protected abstract get keyDescription(): string;

  protected abstract invalidateEntryAsync(): Promise<boolean>;

  invalidateAsync(): Promise<boolean> {
    this.logger.logDebug(`Invalidating cache for key ${this.keyDescription}`);
    return this.invalidateEntryAsync();
  }

  async writeThroughInvalidateAsync<TResult extends IBenzeneResult>(
    modifyDatabaseFunc: () => Promise<TResult>,
  ): Promise<TResult> {
    const result = await modifyDatabaseFunc();

    if (result.isSuccessful) {
      await this.invalidateAsync();
    } else {
      this.logger.logDebug(`Cache unchanged for key ${this.keyDescription}`);
    }

    return result;
  }
}

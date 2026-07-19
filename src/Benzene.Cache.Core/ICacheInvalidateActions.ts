/** Port of Benzene.Cache.Core.ICacheInvalidateActions. */
import { IBenzeneResult } from '@benzene/abstractions';

/**
 * Cache operations that only ever remove entries: an outright invalidate, and a write-through
 * that invalidates once the database mutation succeeds.
 * Port of Benzene.Cache.Core.ICacheInvalidateActions.
 */
export interface ICacheInvalidateActions {
  /** Port of C# `Task<bool> InvalidateAsync()`. */
  invalidateAsync(): Promise<boolean>;

  /** Port of C# `Task<TResult> WriteThroughInvalidateAsync<TResult>(Func<Task<TResult>>)`. */
  writeThroughInvalidateAsync<TResult extends IBenzeneResult>(
    modifyDatabaseFunc: () => Promise<TResult>,
  ): Promise<TResult>;
}

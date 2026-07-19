/** Port of Benzene.Cache.Core.ICacheWriteActions. */
import { IBenzeneResult, IBenzeneResultOf } from '@benzene/abstractions';
import { CacheUpdateAction } from './CacheUpdateAction';
import { ICacheInvalidateActions } from './ICacheInvalidateActions';

/**
 * Cache operations that can also write entries: an outright set, plus write-through variants that
 * mutate the database and then update the cache according to the mutation's result.
 * Port of Benzene.Cache.Core.ICacheWriteActions&lt;T&gt;.
 *
 * Adaptation: C# `TimeSpan? expireIn` becomes `expireIn?: number` measured in **milliseconds**,
 * the port's standard duration unit (see `TimerMiddleware`); `null` → `undefined`.
 */
export interface ICacheWriteActions<T> extends ICacheInvalidateActions {
  /** Port of C# `Task<bool> SetValueAsync(T value, TimeSpan? expireIn = null)`. */
  setValueAsync(value: T, expireIn?: number): Promise<boolean>;

  /**
   * Port of C# `WriteThroughAsync<TResult>(Func<Task<TResult>>) where TResult : IBenzeneResult<T>`.
   * The cache value defaults to the result's payload; the cache action to the default status mapping.
   */
  writeThroughAsync<TResult extends IBenzeneResultOf<T>>(
    modifyDatabaseFunc: () => Promise<TResult>,
  ): Promise<TResult>;

  /** Port of C# `WriteThroughAsync<TResult>(Func<Task<TResult>>, Func<TResult, T> getCacheValue)`. */
  writeThroughAsync<TResult extends IBenzeneResult>(
    modifyDatabaseFunc: () => Promise<TResult>,
    getCacheValue: (result: TResult) => T,
  ): Promise<TResult>;

  /**
   * Port of C# `WriteThroughAsync<TResult>(Func<Task<TResult>>, Func<TResult, T> getCacheValue,
   * Func<TResult, CacheUpdateAction> getCacheAction)`.
   */
  writeThroughAsync<TResult extends IBenzeneResult>(
    modifyDatabaseFunc: () => Promise<TResult>,
    getCacheValue: (result: TResult) => T,
    getCacheAction: (result: TResult) => CacheUpdateAction,
  ): Promise<TResult>;
}

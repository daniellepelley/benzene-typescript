/** Port of Benzene.Cache.Core.ICacheEntry. */
import { IBenzeneResultOf } from '@benzene/abstractions';
import { ICacheWriteActions } from './ICacheWriteActions';

/**
 * A single cache entry: readable, lazily loadable (cache-or-database), and writable/invalidatable
 * (via {@link ICacheWriteActions}). Port of Benzene.Cache.Core.ICacheEntry&lt;T&gt;.
 */
export interface ICacheEntry<T> extends ICacheWriteActions<T> {
  /** Port of C# `Task<T?> GetValueAsync()`. */
  getValueAsync(): Promise<T | undefined>;

  /** Port of C# `Task<IBenzeneResult<T>> LazyLoadAsync(Func<Task<IBenzeneResult<T>>>)`. */
  lazyLoadAsync(
    databaseReadFunc: () => Promise<IBenzeneResultOf<T>>,
  ): Promise<IBenzeneResultOf<T>>;

  /**
   * Port of C# `LazyLoadAsync<TResult>(Func<Task<TResult>> databaseReadFunc,
   * Func<T, TResult> createResult) where TResult : IBenzeneResult<T>`.
   */
  lazyLoadAsync<TResult extends IBenzeneResultOf<T>>(
    databaseReadFunc: () => Promise<TResult>,
    createResult: (value: T) => TResult,
  ): Promise<TResult>;
}

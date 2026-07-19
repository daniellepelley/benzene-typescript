/** Port of Benzene.Cache.Core.CacheEntry. */
import { IBenzeneResultOf } from '@benzene/abstractions';
import { BenzeneResult } from '@benzene/results';
import { CacheWriteActions } from './CacheWriteActions';
import { ICacheEntry } from './ICacheEntry';

/**
 * Abstract lazy-load cache entry: reads a value from the backend and deserializes it, and on a miss
 * falls through to a database read whose successful result it stores. Subclasses supply the concrete
 * read hook ({@link getEntryValueAsync}) alongside the write/invalidate hooks inherited from
 * {@link CacheWriteActions}.
 * Port of Benzene.Cache.Core.CacheEntry&lt;T&gt;.
 *
 * Adaptation: the C# `LazyLoadAsync` wraps its body in a `ProcessTimerFactory.Create(...)` timing
 * scope tagging `cache-status` hit/miss; the deferred process-timer surface means those tags are
 * dropped, but the hit-vs-miss control flow (return cached value without touching the database on a
 * hit; on a miss read the database, store a successful payload, and return the database result) is
 * preserved exactly.
 */
export abstract class CacheEntry<T> extends CacheWriteActions<T> implements ICacheEntry<T> {
  protected abstract getEntryValueAsync(): Promise<string | undefined>;

  async getValueAsync(): Promise<T | undefined> {
    try {
      this.logger.logDebug(`Trying to hit cache key ${this.keyDescription}`);
      const cacheValue = await this.getEntryValueAsync();
      if (cacheValue) {
        return this.serializer.deserialize<T>(cacheValue);
      }
    } catch (ex) {
      this.logger.logError(ex, 'Error occurred when trying to read from cache');
    }
    return undefined;
  }

  lazyLoadAsync(
    databaseReadFunc: () => Promise<IBenzeneResultOf<T>>,
  ): Promise<IBenzeneResultOf<T>>;
  lazyLoadAsync<TResult extends IBenzeneResultOf<T>>(
    databaseReadFunc: () => Promise<TResult>,
    createResult: (value: T) => TResult,
  ): Promise<TResult>;
  async lazyLoadAsync<TResult extends IBenzeneResultOf<T>>(
    databaseReadFunc: () => Promise<TResult>,
    createResult?: (value: T) => TResult,
  ): Promise<TResult> {
    const resolveResult = createResult ?? ((value: T) => BenzeneResult.ok(value) as unknown as TResult);

    const cacheValue = await this.getValueAsync();

    if (cacheValue != null) {
      this.logger.logDebug(`Cache hit for key ${this.keyDescription}`);
      return resolveResult(cacheValue);
    } else {
      this.logger.logDebug(`No hit in cache for key ${this.keyDescription}`);

      const benzeneResult = await databaseReadFunc();

      if (benzeneResult.isSuccessful) {
        await this.setValueAsync(benzeneResult.payload);
      }

      return benzeneResult;
    }
  }
}

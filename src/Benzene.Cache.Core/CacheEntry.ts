/** Port of Benzene.Cache.Core.CacheEntry. */
import { IBenzeneResultOf, LogLevel } from '@benzenejs/abstractions';
import { BenzeneResult } from '@benzenejs/results';
import { CacheWriteActions } from './CacheWriteActions';
import { ICacheEntry } from './ICacheEntry';

/**
 * Abstract lazy-load cache entry: reads a value from the backend and deserializes it, and on a miss
 * falls through to a database read whose successful result it stores. Subclasses supply the concrete
 * read hook ({@link getEntryValueAsync}) alongside the write/invalidate hooks inherited from
 * {@link CacheWriteActions}.
 * Port of Benzene.Cache.Core.CacheEntry&lt;T&gt;.
 *
 * Degradation contract (the cross-port cache safety rules):
 * - a backend **read error is a miss** (logged, never propagated), so a cache outage degrades to a
 *   database read rather than failing the request;
 * - a backend **write error after a successful load is ignored** (logged via {@link logger}, the
 *   optional hook), so the cache never turns an already-successful database read into a failure;
 * - a **load error is returned and not cached** (an unsuccessful database result is passed through
 *   untouched; a thrown one propagates with nothing written);
 * - a missing entry is signalled by `getEntryValueAsync` returning `undefined`/`null` ALONE (the C#
 *   #201 rule) - a stored empty string is a value some serializer can legitimately produce and must
 *   round-trip as a hit, never be mistaken for a miss. A provider's own read-error path must also
 *   return `undefined`, never `''`.
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
    const { value } = await this.tryReadEntryAsync();
    return value;
  }

  /**
   * Reads the entry, returning whether the key was *present* (a real cache hit) separately from the
   * deserialized value. Presence is decided purely by whether {@link getEntryValueAsync} returned
   * `undefined`/`null` - and that ALONE (the C# #201 rule): it is the one universal "nothing stored
   * under this key" signal every provider produces on a genuine miss, whereas a stored empty string
   * is a value some serializer can legitimately produce and must round-trip as a hit, not be
   * mistaken for a miss (treating `''` as a miss re-opens the C# #140 cache-penetration scenario for
   * exactly that serializer). The presence flag also makes an intentionally-cached `null` a real hit
   * (negative caching, see {@link lazyLoadAsync}): the JSON serialization of `null` is the
   * 4-character string `'null'`, never an absent stored value, so presence and "the stored value
   * deserializes to null" are never confused with each other. Every `getEntryValueAsync`
   * implementation must genuinely distinguish a store-level miss (`undefined`) from an empty stored
   * value (`''`) - including on its own error path, where "could not determine presence" must also
   * be `undefined`, never `''`.
   */
  private async tryReadEntryAsync(): Promise<{ found: boolean; value: T | undefined }> {
    try {
      this.logger.logDebug(`Trying to hit cache key ${this.keyDescription}`);
      const cacheValue = await this.getEntryValueAsync();
      if (cacheValue !== undefined && cacheValue !== null) {
        return { found: true, value: this.serializer.deserialize<T>(cacheValue) };
      }
    } catch (ex) {
      // Read error = miss: a cache outage degrades to a database read, never a failed request.
      this.logger.logError(ex, 'Error occurred when trying to read from cache');
    }
    return { found: false, value: undefined };
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

    // A hit is decided purely by presence (`found`), never by whether the deserialized value is
    // itself null - so an intentionally negative-cached null (an explicit setValueAsync of a null
    // value) is a real, repeatable hit rather than a permanent miss that re-runs databaseReadFunc on
    // every call (the C# #140 cache-penetration fix).
    const { found, value: cacheValue } = await this.tryReadEntryAsync();

    if (found) {
      this.logger.logDebug(`Cache hit for key ${this.keyDescription}`);
      return resolveResult(cacheValue!);
    } else {
      this.logger.logDebug(`No hit in cache for key ${this.keyDescription}`);

      const benzeneResult = await databaseReadFunc();

      // A successful result's payload can itself be null/undefined (a reference the database read
      // legitimately produced no value for) - there's nothing to write back in that case, so skip
      // the write rather than caching a "null" placeholder. Callers that want a genuine
      // negative-cache hit should call setValueAsync themselves once they've decided it's cacheable.
      if (benzeneResult.isSuccessful && benzeneResult.payload != null) {
        try {
          await this.setValueAsync(benzeneResult.payload);
        } catch (ex) {
          // Write error ignored (logged): a cache-side write failure after a successful load must
          // never fail the operation - the database result is the answer, the cache write was only
          // an optimisation for next time.
          this.logger.log(
            LogLevel.Warning,
            `Error occurred when trying to write to cache for key ${this.keyDescription}; ` +
              'returning the successful database result anyway',
            ex,
          );
        }
      }

      return benzeneResult;
    }
  }
}

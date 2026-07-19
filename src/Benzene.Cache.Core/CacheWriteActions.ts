/** Port of Benzene.Cache.Core.CacheWriteActions. */
import { IBenzeneResult, IBenzeneResultOf, ISerializer } from '@benzene/abstractions';
import { JsonSerializer } from '@benzene/core-message-handlers';
import { BenzeneResultStatus } from '@benzene/results';
import { CacheUpdateAction } from './CacheUpdateAction';
import { CacheInvalidateActions } from './CacheInvalidateActions';
import { ICacheWriteActions } from './ICacheWriteActions';

/**
 * Abstract base adding write (set) semantics on top of {@link CacheInvalidateActions}. Subclasses
 * supply the concrete backend write hook ({@link setEntryValueAsync}); values are serialized with a
 * JSON serializer before hitting the backend.
 * Port of Benzene.Cache.Core.CacheWriteActions&lt;T&gt;.
 *
 * Adaptation: as with {@link CacheInvalidateActions}, the C# `ProcessTimerFactory.Create(...)`
 * timing scope around `WriteThroughAsync` is dropped (deferred process-timer surface); the
 * set/invalidate/none control flow is preserved. `TimeSpan? expireIn` → `expireIn?: number` (ms).
 */
export abstract class CacheWriteActions<T> extends CacheInvalidateActions implements ICacheWriteActions<T> {
  /** Port of C# `protected ISerializer Serializer { get; }`, constructed as the default JSON serializer. */
  protected readonly serializer: ISerializer = new JsonSerializer();

  protected abstract setEntryValueAsync(value: string, expireIn: number | undefined): Promise<boolean>;

  async setValueAsync(value: T, expireIn?: number): Promise<boolean> {
    this.logger.logDebug(`Setting cache for key ${this.keyDescription}`);
    const cacheValue = this.serializer.serialize(value);
    return this.setEntryValueAsync(cacheValue, expireIn);
  }

  private static defaultCacheActionMapping<TResult extends IBenzeneResult>(result: TResult): CacheUpdateAction {
    switch (result.status) {
      case BenzeneResultStatus.accepted:
      case BenzeneResultStatus.ok:
      case BenzeneResultStatus.created:
      case BenzeneResultStatus.updated:
        return CacheUpdateAction.Set;
      case BenzeneResultStatus.deleted:
        return CacheUpdateAction.Invalidate;
      default:
        return CacheUpdateAction.None;
    }
  }

  writeThroughAsync<TResult extends IBenzeneResultOf<T>>(
    modifyDatabaseFunc: () => Promise<TResult>,
  ): Promise<TResult>;
  writeThroughAsync<TResult extends IBenzeneResult>(
    modifyDatabaseFunc: () => Promise<TResult>,
    getCacheValue: (result: TResult) => T,
  ): Promise<TResult>;
  writeThroughAsync<TResult extends IBenzeneResult>(
    modifyDatabaseFunc: () => Promise<TResult>,
    getCacheValue: (result: TResult) => T,
    getCacheAction: (result: TResult) => CacheUpdateAction,
  ): Promise<TResult>;
  async writeThroughAsync<TResult extends IBenzeneResult>(
    modifyDatabaseFunc: () => Promise<TResult>,
    getCacheValue?: (result: TResult) => T,
    getCacheAction?: (result: TResult) => CacheUpdateAction,
  ): Promise<TResult> {
    const resolveCacheValue =
      getCacheValue ?? ((result: TResult) => (result as unknown as IBenzeneResultOf<T>).payload);
    const resolveCacheAction = getCacheAction ?? CacheWriteActions.defaultCacheActionMapping;

    const result = await modifyDatabaseFunc();

    switch (resolveCacheAction(result)) {
      case CacheUpdateAction.Set:
        await this.setValueAsync(resolveCacheValue(result));
        break;

      case CacheUpdateAction.Invalidate:
        await this.invalidateAsync();
        break;

      default:
        this.logger.logDebug(`Cache unchanged for key ${this.keyDescription}`);
        break;
    }

    return result;
  }
}

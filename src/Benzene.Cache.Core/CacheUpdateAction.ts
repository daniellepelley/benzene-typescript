/** Port of Benzene.Cache.Core.CacheUpdateAction. */

/**
 * The action a write-through operation should take against the cache once the underlying
 * database mutation has completed. Port of the C# `CacheUpdateAction` enum (same member order,
 * so the numeric values line up).
 */
export enum CacheUpdateAction {
  None,
  Set,
  Invalidate,
}

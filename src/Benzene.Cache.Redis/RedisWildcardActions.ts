/** Port of Benzene.Cache.Redis.RedisWildcardActions. */
import { ILogger } from '@benzenejs/abstractions';
import { CacheInvalidateActions } from '@benzenejs/cache-core';
import type { RedisCacheService } from './RedisCacheService';

/**
 * Invalidates every Redis key matching a glob-style pattern: fetches the matching keys, then deletes
 * them in batches. Port of Benzene.Cache.Redis.RedisWildcardActions (C# `internal` → exported here).
 *
 * StackExchange.Redis → ioredis mapping: the C# `IDatabase.ExecuteAsync("KEYS", pattern)` raw command
 * becomes ioredis `keys(pattern)` (`KEYS`); `KeyDeleteAsync(keys[])` becomes `del(...batch)` (`DEL`).
 * The C# batch size (`MaxKeyForDelete = 1_048_000`) is preserved. Returns `true` when at least one key
 * was deleted; backend errors are caught and logged, matching the C# behaviour.
 *
 * Note (carried over from the C#): `KEYS` scans the whole keyspace and can block Redis on large
 * datasets — a faithful port of the original, not a recommendation.
 *
 * Safety guard (the C# #198 rule): an effectively-universal pattern (empty/whitespace, or all `*`)
 * is refused with a thrown error before any Redis command runs — it would delete every key in the
 * logical database, which is never an implicit intent.
 */
export class RedisWildcardActions extends CacheInvalidateActions {
  private static readonly maxKeyForDelete = 1048000;

  private readonly service: RedisCacheService;
  private readonly pattern: string;

  constructor(redisCacheService: RedisCacheService, pattern: string) {
    super();
    this.service = redisCacheService;
    this.pattern = pattern;
  }

  protected get logger(): ILogger {
    return this.service.logger;
  }

  protected get keyDescription(): string {
    return this.pattern;
  }

  protected async invalidateEntryAsync(): Promise<boolean> {
    // The C# #198 defense-in-depth guard: createPrefixActions already rejects an empty/whitespace
    // prefix before it ever reaches here, but this type is also reachable directly via
    // createWildcardActions (an unescaped, caller-supplied pattern by design) and this is the last
    // point before a real Redis KEYS scan runs. Never execute a bare/effectively-universal pattern -
    // that would delete every key in the logical database.
    if (isEffectivelyUniversalPattern(this.pattern)) {
      this.logger.logError(
        undefined,
        `Refusing to run cache invalidation for pattern '${this.pattern}': it would match the entire keyspace`,
      );
      throw new Error(
        `Refusing to run cache invalidation for pattern '${this.pattern}': it would match the ` +
          'entire keyspace. This is a defense-in-depth guard - check what produced this pattern.',
      );
    }

    let deletedKeys = 0;
    try {
      const redisClient = await this.service.redisSetup();
      this.logger.logDebug(`Sending ${this.pattern} search to cache`);
      const result = await redisClient.keys(this.pattern);
      this.logger.logDebug(`BenzeneResult for ${this.pattern} - ${result.length} keys.`);
      for (let i = 0; i < result.length; i += RedisWildcardActions.maxKeyForDelete) {
        const keysForSending = result.slice(i, i + RedisWildcardActions.maxKeyForDelete);
        this.logger.logDebug(`Deleting batch of ${keysForSending.length} keys.`);
        deletedKeys += await redisClient.del(...keysForSending);
      }
      this.logger.logDebug(`Deleted ${deletedKeys} keys.`);
    } catch {
      this.logger.logWarning('Error deleting keys from cache');
    }
    return deletedKeys > 0;
  }
}

/**
 * Whether `pattern` would match every key in the keyspace: empty/whitespace-only, or - after
 * trimming - composed entirely of the glob wildcard `*` (Redis glob syntax treats one or more
 * consecutive `*` identically to a single one, so `'*'`, `'**'`, and `' * '` are all equally
 * universal). Port of C# `RedisWildcardActions.IsEffectivelyUniversalPattern`.
 */
function isEffectivelyUniversalPattern(pattern: string): boolean {
  const trimmed = pattern.trim();
  return trimmed.length === 0 || [...trimmed].every((c) => c === '*');
}

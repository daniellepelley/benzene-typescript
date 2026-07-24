/**
 * Port of the `System.Threading.RateLimiting.RateLimitLease` + `MetadataName<T>` subset the rate-limiting
 * package relies on. .NET ships these in the BCL (`System.Threading.RateLimiting`); Node has no
 * equivalent, so the used subset is re-created here, in this package, rather than pulled in as a
 * dependency. Kept deliberately minimal - only what {@link RateLimitingMiddleware} and the concrete
 * limiters need.
 */

/**
 * A typed key for a piece of lease metadata. Port of `System.Threading.RateLimiting.MetadataName<T>`.
 * Only the one entry the middleware reads is defined.
 */
export class MetadataName<T> {
  private constructor(readonly name: string) {}

  /** The suggested wait before retrying, in milliseconds. Port of `MetadataName.RetryAfter` (a `TimeSpan` in .NET). */
  static readonly retryAfter = new MetadataName<number>('RETRY_AFTER');
}

/** Result of {@link RateLimitLease.tryGetMetadata}. Models C#'s `bool TryGetMetadata(name, out T)`. */
export interface MetadataLookup<T> {
  readonly found: boolean;
  readonly value: T | undefined;
}

/**
 * The outcome of an acquisition attempt. Port of `System.Threading.RateLimiting.RateLimitLease`.
 *
 * When `isAcquired` is true the permits are held until {@link dispose} is called; a concurrency-style
 * limiter returns them then (window/bucket limiters ignore disposal). Metadata (e.g. `retryAfter`) may
 * accompany a rejected lease.
 */
export class RateLimitLease {
  private disposed = false;

  constructor(
    readonly isAcquired: boolean,
    private readonly metadata?: ReadonlyMap<string, unknown>,
    private readonly onDispose?: () => void,
  ) {}

  /** Port of C#'s `bool TryGetMetadata(MetadataName<T>, out T)`; the `out` becomes the returned `value`. */
  tryGetMetadata<T>(name: MetadataName<T>): MetadataLookup<T> {
    const found = this.metadata?.has(name.name) ?? false;
    return { found, value: found ? (this.metadata!.get(name.name) as T) : undefined };
  }

  /** Releases any held permits. Idempotent, mirroring `IDisposable.Dispose` being safe to call once. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.onDispose?.();
  }
}

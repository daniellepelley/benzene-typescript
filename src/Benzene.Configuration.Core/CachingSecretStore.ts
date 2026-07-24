import { ISecretStore } from './ISecretStore';

/** How long a value is cached by default: 5 minutes, in milliseconds. */
const defaultTimeToLiveMs = 5 * 60 * 1000;

interface Entry {
  value: string | undefined;
  expiresAt: number;
}

/**
 * Caches values from an inner store for a time-to-live, so a remote secret store (Key Vault, AWS
 * Secrets Manager, ...) is not hit on every read. This is the "optional reload" seam: a cached value
 * refreshes when its TTL lapses, and {@link invalidate}/{@link invalidateAll} force an immediate
 * re-fetch - e.g. after a secret rotation.
 * Port of Benzene.Configuration.Core.CachingSecretStore.
 *
 * An absent (`undefined`) result is cached too, so a genuinely-missing name is not re-queried on every
 * read within the TTL. `TimeSpan`/`DateTimeOffset` map to millisecond `number`s with an injectable
 * clock; the C# `ConcurrentDictionary` maps to a `Map` (Node's single-threaded read path needs no lock).
 */
export class CachingSecretStore implements ISecretStore {
  private readonly inner: ISecretStore;
  private readonly timeToLiveMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, Entry>();

  /**
   * @param inner The store whose values are cached.
   * @param timeToLiveMs How long a value is cached, in milliseconds. Defaults to 5 minutes.
   * @param now A clock, overridable for tests. Defaults to `Date.now`.
   */
  constructor(inner: ISecretStore, timeToLiveMs: number = defaultTimeToLiveMs, now: () => number = () => Date.now()) {
    this.inner = inner;
    this.timeToLiveMs = timeToLiveMs;
    this.now = now;
  }

  async getSecretAsync(name: string, signal?: AbortSignal): Promise<string | undefined> {
    const now = this.now();
    const entry = this.cache.get(name);
    if (entry !== undefined && entry.expiresAt > now) {
      return entry.value;
    }

    const value = await this.inner.getSecretAsync(name, signal);
    this.cache.set(name, { value, expiresAt: now + this.timeToLiveMs });
    return value;
  }

  /** Drops the cached value for `name` so the next read re-fetches it. */
  invalidate(name: string): void {
    this.cache.delete(name);
  }

  /** Drops every cached value so the next read of each re-fetches it. */
  invalidateAll(): void {
    this.cache.clear();
  }
}

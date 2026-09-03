/**
 * Port-style tests for Benzene.Cache.Core's lazy-load / write / invalidate flows, exercised through
 * a concrete `CacheEntry<T>` subclass backed by an in-memory string store (no Redis).
 */
import { describe, expect, it, vi } from 'vitest';
import { IBenzeneResultOf, ILogger, IDisposable, LogLevel, LoggerBase } from '@benzenejs/abstractions';
import { BenzeneResult, BenzeneResultStatus } from '@benzenejs/results';
import { CacheEntry, CacheUpdateAction } from '@benzenejs/cache-core';

interface Widget {
  id: string;
  name: string;
}

/** Records every log call so tests can assert the swallowed-read error is logged. */
class CapturingLogger extends LoggerBase {
  readonly entries: { level: LogLevel; message: string; error?: unknown }[] = [];

  log(logLevel: LogLevel, message: string, error?: unknown): void {
    this.entries.push({ level: logLevel, message, error });
  }

  beginScope(): IDisposable {
    return { dispose: () => {} };
  }
}

/** Concrete `CacheEntry<T>` over a shared `Map<string, string>` acting as the cache backend. */
class InMemoryCacheEntry<T> extends CacheEntry<T> {
  constructor(
    private readonly store: Map<string, string>,
    private readonly key: string,
    private readonly log: ILogger,
    private readonly throwOnRead = false,
    private readonly throwOnWrite = false,
  ) {
    super();
  }

  protected get logger(): ILogger {
    return this.log;
  }

  protected get keyDescription(): string {
    return this.key;
  }

  protected getEntryValueAsync(): Promise<string | undefined> {
    if (this.throwOnRead) {
      throw new Error('backend read blew up');
    }
    return Promise.resolve(this.store.get(this.key));
  }

  protected setEntryValueAsync(value: string): Promise<boolean> {
    if (this.throwOnWrite) {
      throw new Error('backend write blew up');
    }
    this.store.set(this.key, value);
    return Promise.resolve(true);
  }

  protected invalidateEntryAsync(): Promise<boolean> {
    return Promise.resolve(this.store.delete(this.key));
  }
}

const widget: Widget = { id: '1', name: 'sprocket' };

describe('CacheEntry (cache-core)', () => {
  describe('getValueAsync', () => {
    it('returns the deserialized value on a cache hit', async () => {
      const store = new Map<string, string>([['widget:1', JSON.stringify(widget)]]);
      const entry = new InMemoryCacheEntry<Widget>(store, 'widget:1', new CapturingLogger());

      expect(await entry.getValueAsync()).toEqual(widget);
    });

    it('returns undefined on a cache miss', async () => {
      const entry = new InMemoryCacheEntry<Widget>(new Map(), 'widget:1', new CapturingLogger());

      expect(await entry.getValueAsync()).toBeUndefined();
    });

    it('swallows a throwing backend read, logging the error and returning undefined', async () => {
      const logger = new CapturingLogger();
      const entry = new InMemoryCacheEntry<Widget>(new Map(), 'widget:1', logger, true);

      expect(await entry.getValueAsync()).toBeUndefined();
      const errorLog = logger.entries.find((e) => e.level === LogLevel.Error);
      expect(errorLog?.message).toBe('Error occurred when trying to read from cache');
      expect(errorLog?.error).toBeInstanceOf(Error);
    });
  });

  describe('lazyLoadAsync', () => {
    it('returns the cached value on a hit without invoking the database-read func', async () => {
      const store = new Map<string, string>([['widget:1', JSON.stringify(widget)]]);
      const entry = new InMemoryCacheEntry<Widget>(store, 'widget:1', new CapturingLogger());
      const dbRead = vi.fn(() => Promise.resolve(BenzeneResult.ok<Widget>({ id: '1', name: 'from-db' })));

      const result = await entry.lazyLoadAsync(dbRead);

      expect(dbRead).not.toHaveBeenCalled();
      expect(result.payload).toEqual(widget);
      expect(result.status).toBe(BenzeneResultStatus.ok);
    });

    it('on a miss calls the database-read func, stores the payload, and returns the db result', async () => {
      const store = new Map<string, string>();
      const entry = new InMemoryCacheEntry<Widget>(store, 'widget:1', new CapturingLogger());
      const fromDb: Widget = { id: '1', name: 'from-db' };
      const dbRead = vi.fn(() => Promise.resolve(BenzeneResult.ok(fromDb)));

      const result = await entry.lazyLoadAsync(dbRead);

      expect(dbRead).toHaveBeenCalledTimes(1);
      expect(result.payload).toEqual(fromDb);
      // stored for next time
      expect(store.get('widget:1')).toBe(JSON.stringify(fromDb));
      expect(await entry.getValueAsync()).toEqual(fromDb);
    });

    it('on a miss does NOT store when the database read is unsuccessful', async () => {
      const store = new Map<string, string>();
      const entry = new InMemoryCacheEntry<Widget>(store, 'widget:1', new CapturingLogger());
      const dbRead = vi.fn(() => Promise.resolve(BenzeneResult.notFound<Widget>('nope')));

      const result = await entry.lazyLoadAsync(dbRead);

      expect(result.status).toBe(BenzeneResultStatus.notFound);
      expect(store.has('widget:1')).toBe(false);
    });

    // --- The degradation contract (the cross-port cache safety rules) ---

    it('a backend read error is a miss: the database is read and its result returned', async () => {
      const logger = new CapturingLogger();
      const entry = new InMemoryCacheEntry<Widget>(new Map(), 'widget:1', logger, true);
      const fromDb: Widget = { id: '1', name: 'from-db' };
      const dbRead = vi.fn(() => Promise.resolve(BenzeneResult.ok(fromDb)));

      const result = await entry.lazyLoadAsync(dbRead);

      expect(dbRead).toHaveBeenCalledTimes(1);
      expect(result.payload).toEqual(fromDb);
      expect(logger.entries.some((e) => e.level === LogLevel.Error)).toBe(true);
    });

    it('a backend write error after a successful load is ignored (logged), never failing the operation', async () => {
      const logger = new CapturingLogger();
      const store = new Map<string, string>();
      const entry = new InMemoryCacheEntry<Widget>(store, 'widget:1', logger, false, true);
      const fromDb: Widget = { id: '1', name: 'from-db' };

      const result = await entry.lazyLoadAsync(() => Promise.resolve(BenzeneResult.ok(fromDb)));

      // The successful database result is still the answer; nothing was cached.
      expect(result.status).toBe(BenzeneResultStatus.ok);
      expect(result.payload).toEqual(fromDb);
      expect(store.has('widget:1')).toBe(false);
      const warning = logger.entries.find((e) => e.level === LogLevel.Warning);
      expect(warning?.message).toContain('Error occurred when trying to write to cache');
      expect(warning?.error).toBeInstanceOf(Error);
    });

    it('a thrown database-read error propagates and nothing is cached', async () => {
      const store = new Map<string, string>();
      const entry = new InMemoryCacheEntry<Widget>(store, 'widget:1', new CapturingLogger());

      await expect(entry.lazyLoadAsync(() => Promise.reject(new Error('db down')))).rejects.toThrow(
        'db down',
      );
      expect(store.has('widget:1')).toBe(false);
    });

    it('a stored empty string is a valid cached value, not a miss (#201)', async () => {
      // The serialized form of the empty string ('""') round-trips as a real hit.
      const store = new Map<string, string>([['greeting', '""']]);
      const entry = new InMemoryCacheEntry<string>(store, 'greeting', new CapturingLogger());
      const dbRead = vi.fn(() => Promise.resolve(BenzeneResult.ok('from-db')));

      const result = await entry.lazyLoadAsync(dbRead);

      expect(dbRead).not.toHaveBeenCalled();
      expect(result.payload).toBe('');
    });

    it('an intentionally-cached null is a real hit, not a permanent miss (negative caching)', async () => {
      // Presence, not the deserialized value, decides a hit: the JSON of null is the stored string
      // 'null', so a negative-cached entry short-circuits the database read instead of re-running it
      // on every call (the C# #140 cache-penetration fix).
      const store = new Map<string, string>([['widget:1', 'null']]);
      const entry = new InMemoryCacheEntry<Widget | null>(store, 'widget:1', new CapturingLogger());
      const dbRead = vi.fn(() => Promise.resolve(BenzeneResult.ok<Widget | null>(widget)));
      let hitValue: Widget | null | undefined;

      await entry.lazyLoadAsync(dbRead, (value) => {
        hitValue = value;
        return BenzeneResult.ok<Widget | null>(value ?? undefined);
      });

      expect(dbRead).not.toHaveBeenCalled();
      expect(hitValue).toBeNull(); // the cached null itself, not a re-run of the database read
    });

    it('a successful database result with a null payload is returned but NOT written back', async () => {
      const store = new Map<string, string>();
      const entry = new InMemoryCacheEntry<Widget | null>(store, 'widget:1', new CapturingLogger());
      // The BenzeneResult factories coalesce a null payload to VoidResult, so a genuinely-null
      // payload only arises from a custom IBenzeneResultOf implementation - which handlers may
      // legitimately return.
      const nullPayloadResult: IBenzeneResultOf<Widget | null> = {
        status: BenzeneResultStatus.ok,
        payload: null,
        payloadAsObject: null,
        errors: [],
        isSuccessful: true,
      };

      const result = await entry.lazyLoadAsync(() => Promise.resolve(nullPayloadResult));

      expect(result.status).toBe(BenzeneResultStatus.ok);
      expect(store.has('widget:1')).toBe(false); // no 'null' placeholder cached automatically
    });
  });

  describe('write / invalidate actions', () => {
    it('setValueAsync serializes and stores the value', async () => {
      const store = new Map<string, string>();
      const entry = new InMemoryCacheEntry<Widget>(store, 'widget:1', new CapturingLogger());

      expect(await entry.setValueAsync(widget)).toBe(true);
      expect(store.get('widget:1')).toBe(JSON.stringify(widget));
    });

    it('invalidateAsync removes the entry', async () => {
      const store = new Map<string, string>([['widget:1', JSON.stringify(widget)]]);
      const entry = new InMemoryCacheEntry<Widget>(store, 'widget:1', new CapturingLogger());

      expect(await entry.invalidateAsync()).toBe(true);
      expect(store.has('widget:1')).toBe(false);
    });

    it('writeThroughAsync sets the cache from the payload on a successful (Ok) result', async () => {
      const store = new Map<string, string>();
      const entry = new InMemoryCacheEntry<Widget>(store, 'widget:1', new CapturingLogger());

      const result = await entry.writeThroughAsync(() => Promise.resolve(BenzeneResult.ok(widget)));

      expect(result.status).toBe(BenzeneResultStatus.ok);
      expect(store.get('widget:1')).toBe(JSON.stringify(widget));
    });

    it('writeThroughAsync invalidates the cache on a Deleted result', async () => {
      const store = new Map<string, string>([['widget:1', JSON.stringify(widget)]]);
      const entry = new InMemoryCacheEntry<Widget>(store, 'widget:1', new CapturingLogger());

      const result = await entry.writeThroughAsync(
        () => Promise.resolve(BenzeneResult.deleted<Widget>()),
        () => widget,
      );

      expect(result.status).toBe(BenzeneResultStatus.deleted);
      expect(store.has('widget:1')).toBe(false);
    });

    it('writeThroughAsync leaves the cache untouched when the action maps to None', async () => {
      const store = new Map<string, string>([['widget:1', JSON.stringify(widget)]]);
      const entry = new InMemoryCacheEntry<Widget>(store, 'widget:1', new CapturingLogger());

      const result = await entry.writeThroughAsync(
        () => Promise.resolve(BenzeneResult.badRequest<Widget>('bad')),
        () => widget,
      );

      expect(result.status).toBe(BenzeneResultStatus.badRequest);
      expect(store.get('widget:1')).toBe(JSON.stringify(widget));
    });

    it('writeThroughAsync honours an explicit cache-action selector', async () => {
      const store = new Map<string, string>([['widget:1', JSON.stringify(widget)]]);
      const entry = new InMemoryCacheEntry<Widget>(store, 'widget:1', new CapturingLogger());

      const result = await entry.writeThroughAsync(
        () => Promise.resolve(BenzeneResult.ok(widget)),
        () => widget,
        () => CacheUpdateAction.Invalidate,
      );

      expect(result.status).toBe(BenzeneResultStatus.ok);
      expect(store.has('widget:1')).toBe(false);
    });

    it('writeThroughInvalidateAsync invalidates only on a successful result', async () => {
      const store = new Map<string, string>([['widget:1', JSON.stringify(widget)]]);
      const entry = new InMemoryCacheEntry<Widget>(store, 'widget:1', new CapturingLogger());

      await entry.writeThroughInvalidateAsync(() => Promise.resolve(BenzeneResult.badRequest('nope')));
      expect(store.has('widget:1')).toBe(true);

      await entry.writeThroughInvalidateAsync(() => Promise.resolve(BenzeneResult.ok<Widget>(widget)));
      expect(store.has('widget:1')).toBe(false);
    });
  });
});

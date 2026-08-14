import { afterEach, describe, expect, it, vi } from 'vitest';
import { serviceToken } from '@benzenejs/abstractions';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';

/** A scoped resource that records async teardown — the shape a Unit of Work / DB session takes. */
class AsyncResource {
  constructor(
    private readonly log: string[],
    private readonly id: string,
  ) {}

  async disposeAsync(): Promise<void> {
    // Await a microtask so a broken (non-awaiting) disposer would interleave and fail the order asserts.
    await Promise.resolve();
    this.log.push(`async:${this.id}`);
  }
}

class SyncResource {
  constructor(
    private readonly log: string[],
    private readonly id: string,
  ) {}

  dispose(): void {
    this.log.push(`sync:${this.id}`);
  }
}

const A = serviceToken<AsyncResource>('A');
const B = serviceToken<AsyncResource>('B');
const S = serviceToken<SyncResource>('S');

describe('DI async disposal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('disposeAsync awaits async disposers in reverse (LIFO) order', async () => {
    const log: string[] = [];
    const container = new DefaultBenzeneServiceContainer();
    container.addScopedFactory(A, () => new AsyncResource(log, 'A'));
    container.addScopedFactory(B, () => new AsyncResource(log, 'B'));

    const factory = container.createServiceResolverFactory();
    const scope = factory.createScope();
    scope.getService(A);
    scope.getService(B); // resolved after A, so torn down before A

    await scope.disposeAsync!();

    expect(log).toEqual(['async:B', 'async:A']);
  });

  it('sync dispose() releases sync disposables but leaves async-only ones', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {}); // async-only skip warns; asserted elsewhere
    const log: string[] = [];
    const container = new DefaultBenzeneServiceContainer();
    container.addScopedFactory(S, () => new SyncResource(log, 'S'));
    container.addScopedFactory(A, () => new AsyncResource(log, 'A'));

    const scope = container.createServiceResolverFactory().createScope();
    scope.getService(S);
    scope.getService(A);

    scope.dispose();

    expect(log).toEqual(['sync:S']); // the async-only resource is not (cannot be) awaited here
  });

  it('disposeAsync releases both sync and async disposables', async () => {
    const log: string[] = [];
    const container = new DefaultBenzeneServiceContainer();
    container.addScopedFactory(S, () => new SyncResource(log, 'S'));
    container.addScopedFactory(A, () => new AsyncResource(log, 'A'));

    const scope = container.createServiceResolverFactory().createScope();
    scope.getService(S);
    scope.getService(A);

    await scope.disposeAsync!();

    expect(log.sort()).toEqual(['async:A', 'sync:S']);
  });

  it('disposeAsync is idempotent', async () => {
    const log: string[] = [];
    const container = new DefaultBenzeneServiceContainer();
    container.addScopedFactory(A, () => new AsyncResource(log, 'A'));

    const scope = container.createServiceResolverFactory().createScope();
    scope.getService(A);

    await scope.disposeAsync!();
    await scope.disposeAsync!();

    expect(log).toEqual(['async:A']);
  });

  it('sync dispose() warns (once) when it skips an async-only disposable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log: string[] = [];
    const container = new DefaultBenzeneServiceContainer();
    container.addScopedFactory(A, () => new AsyncResource(log, 'A'));
    container.addScopedFactory(B, () => new AsyncResource(log, 'B'));

    const scope = container.createServiceResolverFactory().createScope();
    scope.getService(A);
    scope.getService(B); // two async-only resources skipped, but warned only once

    scope.dispose();

    expect(warn).toHaveBeenCalledTimes(1);
    const message = (warn.mock.calls[0][0] as string).toLowerCase();
    expect(message).toContain('disposeasync');
    expect(log).toEqual([]); // neither async-only resource was released
  });

  it('disposeAsync() does NOT warn about async-only disposables', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log: string[] = [];
    const container = new DefaultBenzeneServiceContainer();
    container.addScopedFactory(A, () => new AsyncResource(log, 'A'));

    const scope = container.createServiceResolverFactory().createScope();
    scope.getService(A);

    await scope.disposeAsync!();

    expect(warn).not.toHaveBeenCalled();
    expect(log).toEqual(['async:A']);
  });

  it('sync dispose() does NOT warn when the only disposable is synchronous', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log: string[] = [];
    const container = new DefaultBenzeneServiceContainer();
    container.addScopedFactory(S, () => new SyncResource(log, 'S'));

    const scope = container.createServiceResolverFactory().createScope();
    scope.getService(S);

    scope.dispose();

    expect(warn).not.toHaveBeenCalled();
    expect(log).toEqual(['sync:S']);
  });

  it('factory.disposeAsync awaits async-disposable singletons', async () => {
    const log: string[] = [];
    const container = new DefaultBenzeneServiceContainer();
    container.addSingletonFactory(A, () => new AsyncResource(log, 'singleton'));

    const factory = container.createServiceResolverFactory();
    factory.createScope().getService(A);

    await factory.disposeAsync!();

    expect(log).toEqual(['async:singleton']);
  });
});

/**
 * Disposal duck-typing shared by the scope and the resolver factory.
 *
 * A scoped instance can implement synchronous disposal (`dispose(): void`, the port of C#
 * `IDisposable`), asynchronous disposal (`disposeAsync(): Promise<void>` or the standard
 * `Symbol.asyncDispose`, the port of C# `IAsyncDisposable`), or both. Asynchronous disposal is what
 * a scoped Unit of Work needs: committing/rolling back a transaction at scope end is awaitable work
 * a synchronous `dispose()` cannot express.
 */

// Referenced defensively: Symbol.asyncDispose exists at runtime on Node 20+, but the ES2022 lib this
// package compiles against doesn't type it. Cast rather than widen the whole project's lib.
const asyncDisposeSymbol: symbol | undefined = (Symbol as { asyncDispose?: symbol }).asyncDispose;

/** A synchronously-disposable instance (C# `IDisposable`). */
export interface DisposableLike {
  dispose(): void;
}

/** An asynchronously-disposable instance (C# `IAsyncDisposable`). */
export interface AsyncDisposableLike {
  disposeAsync(): PromiseLike<void>;
}

export function isDisposable(value: unknown): value is DisposableLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as DisposableLike).dispose === 'function'
  );
}

export function isAsyncDisposable(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (typeof (value as AsyncDisposableLike).disposeAsync === 'function') {
    return true;
  }
  return (
    asyncDisposeSymbol !== undefined &&
    typeof (value as Record<symbol, unknown>)[asyncDisposeSymbol] === 'function'
  );
}

/** True if the instance can be disposed either synchronously or asynchronously. */
export function isAnyDisposable(value: unknown): boolean {
  return isDisposable(value) || isAsyncDisposable(value);
}

/**
 * Disposes an instance, preferring its asynchronous disposer. Awaits `disposeAsync()` /
 * `Symbol.asyncDispose` when present; otherwise falls back to synchronous `dispose()`. Safe to call
 * on anything — a non-disposable value is a no-op.
 */
export async function disposeInstanceAsync(value: unknown): Promise<void> {
  if (typeof value !== 'object' || value === null) {
    return;
  }
  const record = value as Record<string | symbol, unknown>;

  if (typeof record.disposeAsync === 'function') {
    await (record.disposeAsync as () => PromiseLike<void>).call(value);
    return;
  }
  if (asyncDisposeSymbol !== undefined && typeof record[asyncDisposeSymbol] === 'function') {
    await (record[asyncDisposeSymbol] as () => PromiseLike<void>).call(value);
    return;
  }
  if (typeof record.dispose === 'function') {
    (record.dispose as () => void).call(value);
  }
}

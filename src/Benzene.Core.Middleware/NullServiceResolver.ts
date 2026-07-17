import { IServiceResolver } from '@benzene/abstractions';

/**
 * Null-object resolver that resolves nothing.
 * Port of Benzene.Core.Middleware.NullServiceResolver
 * (C# `default!`/`null` returns map to `undefined`).
 */
export class NullServiceResolver implements IServiceResolver {
  getService<T>(): T {
    return undefined as T;
  }

  tryGetService<T>(): T | undefined {
    return undefined;
  }

  getServices<T>(): T[] {
    return [];
  }

  dispose(): void {}
}

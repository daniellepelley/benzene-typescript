import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Derives the idempotency key for a message from its transport context. Register a custom
 * implementation to key de-duplication on something other than the header/body default (e.g. a
 * business identifier pulled from the payload).
 * Port of Benzene.Idempotency.IIdempotencyKeyStrategy&lt;TContext&gt;.
 */
export interface IIdempotencyKeyStrategy<TContext> {
  /**
   * Returns the idempotency key for the message, or `undefined` to skip de-duplication and let the
   * message through untracked. (C# `null` maps to `undefined`.)
   */
  getKey(context: TContext): string | undefined;
}

/**
 * Shared container token for `IIdempotencyKeyStrategy<TContext>`, following the `<unknown>` precedent
 * used across the port for erased-generic tokens; `useIdempotency` casts the resolved strategy back to
 * its `TContext`.
 */
export const IIdempotencyKeyStrategy: ServiceToken<IIdempotencyKeyStrategy<unknown>> =
  serviceToken<IIdempotencyKeyStrategy<unknown>>('IIdempotencyKeyStrategy');

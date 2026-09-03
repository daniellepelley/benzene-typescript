import { ServiceToken, serviceToken } from '@benzenejs/abstractions';
import { ClaimResult } from './ClaimResult';

/**
 * Pluggable persistence for idempotency keys. Records which messages have already been (or are
 * currently being) processed so that redeliveries on an at-least-once transport can be de-duplicated.
 * Swap the implementation to change where records live (in-memory for a single instance, Redis/a
 * database for a multi-instance deployment) without touching the middleware.
 * Port of Benzene.Idempotency.IIdempotencyStore.
 *
 * The store owns its own retention policy (time-to-live); the middleware never passes an expiry. Keep
 * records long enough to outlive the transport's maximum redelivery window. C# `CancellationToken`
 * maps to an optional `AbortSignal` (the port-wide convention), checked via `signal?.throwIfAborted()`.
 */
export interface IIdempotencyStore {
  /**
   * Atomically claims `key` for first-time processing. If no live record exists, persists a new
   * {@link IdempotencyStatus.InProgress} record, mints a fresh opaque claim token, and returns
   * {@link ClaimResult.won} carrying it in {@link ClaimResult.claimToken}; if a live record already
   * exists, returns {@link ClaimResult.alreadyExists} with that record and leaves it unchanged.
   * Implementations MUST make the check-and-insert atomic so concurrent redeliveries cannot both win.
   */
  tryClaimAsync(key: string, signal?: AbortSignal): Promise<ClaimResult>;

  /**
   * Promotes a previously-claimed key to {@link IdempotencyStatus.Completed}, recording the outcome so
   * future duplicates can be short-circuited.
   *
   * `claimToken` MUST be the token {@link ClaimResult.claimToken} returned when this caller won the
   * claim. Implementations MUST make the settle write conditional on that token still being the live
   * claim's token, and return `false` without writing anything when it is not - the claim lapsed and
   * was reclaimed by another worker, or was already settled. A fenced write never clobbers whoever
   * holds the claim now; there is no way to skip the token (no optional parameter, no overload) - a
   * skippable fence is no fence.
   *
   * @returns `true` if `claimToken` matched the live claim and the record was written; `false` if
   * there was no live claim with that token and nothing was written.
   */
  completeAsync(
    key: string,
    claimToken: string,
    wasSuccessful: boolean,
    signal?: AbortSignal,
  ): Promise<boolean>;

  /**
   * Removes a claim so the message can be reprocessed when the transport redelivers it. Called when the
   * handler throws or reports failure, so a transient error does not permanently suppress the message.
   *
   * Same token-fencing contract as {@link completeAsync}: `claimToken` MUST be the token returned by
   * the winning {@link tryClaimAsync} call, the release is conditional on it still matching the live
   * claim, and a mismatch returns `false` without removing anything - the claim already lapsed/was
   * reclaimed, so there is nothing this caller still owns to release.
   *
   * @returns `true` if `claimToken` matched the live claim and it was removed; `false` if there was no
   * live claim with that token and nothing was written.
   */
  releaseAsync(key: string, claimToken: string, signal?: AbortSignal): Promise<boolean>;
}

export const IIdempotencyStore: ServiceToken<IIdempotencyStore> =
  serviceToken<IIdempotencyStore>('IIdempotencyStore');

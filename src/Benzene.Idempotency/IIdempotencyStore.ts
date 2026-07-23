import { ServiceToken, serviceToken } from '@benzene/abstractions';
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
   * {@link IdempotencyStatus.InProgress} record and returns {@link ClaimResult.won}; if a live record
   * already exists, returns {@link ClaimResult.alreadyExists} with that record and leaves it unchanged.
   * Implementations MUST make the check-and-insert atomic so concurrent redeliveries cannot both win.
   */
  tryClaimAsync(key: string, signal?: AbortSignal): Promise<ClaimResult>;

  /**
   * Promotes a previously-claimed key to {@link IdempotencyStatus.Completed}, recording the outcome so
   * future duplicates can be short-circuited.
   */
  completeAsync(key: string, wasSuccessful: boolean, signal?: AbortSignal): Promise<void>;

  /**
   * Removes a claim so the message can be reprocessed when the transport redelivers it. Called when the
   * handler throws or reports failure, so a transient error does not permanently suppress the message.
   */
  releaseAsync(key: string, signal?: AbortSignal): Promise<void>;
}

export const IIdempotencyStore: ServiceToken<IIdempotencyStore> =
  serviceToken<IIdempotencyStore>('IIdempotencyStore');

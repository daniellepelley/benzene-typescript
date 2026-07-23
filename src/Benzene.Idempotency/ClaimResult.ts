import { IdempotencyRecord } from './IdempotencyRecord';

/**
 * The outcome of an {@link IIdempotencyStore.tryClaimAsync} call: either this caller won the claim and
 * should process the message, or a record already existed (a duplicate).
 * Port of Benzene.Idempotency.ClaimResult.
 */
export class ClaimResult {
  /**
   * Whether this caller won the claim. When `true`, the caller is the first to see this key and should
   * process the message; when `false`, the message is a duplicate.
   */
  readonly claimed: boolean;

  /** The record that already existed when the claim was refused. `undefined` when {@link claimed} is `true`. */
  readonly existingRecord: IdempotencyRecord | undefined;

  private constructor(claimed: boolean, existingRecord: IdempotencyRecord | undefined) {
    this.claimed = claimed;
    this.existingRecord = existingRecord;
  }

  /** Creates a result indicating the caller won the claim. */
  static won(): ClaimResult {
    return new ClaimResult(true, undefined);
  }

  /** Creates a result indicating a record already existed (the message is a duplicate). */
  static alreadyExists(existing: IdempotencyRecord): ClaimResult {
    return new ClaimResult(false, existing);
  }
}

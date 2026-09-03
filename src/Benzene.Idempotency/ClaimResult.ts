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

  /**
   * The opaque token the store minted for this claim. Defined exactly when {@link claimed} is `true`.
   * The caller MUST present this token, unchanged, to {@link IIdempotencyStore.completeAsync}/
   * {@link IIdempotencyStore.releaseAsync} - a settle call whose token no longer matches the live claim
   * (it lapsed and was reclaimed by another worker, or was already settled) is refused rather than
   * allowed to clobber whoever holds the claim now.
   */
  readonly claimToken: string | undefined;

  private constructor(
    claimed: boolean,
    existingRecord: IdempotencyRecord | undefined,
    claimToken: string | undefined,
  ) {
    this.claimed = claimed;
    this.existingRecord = existingRecord;
    this.claimToken = claimToken;
  }

  /**
   * Creates a result indicating the caller won the claim.
   * @param claimToken The opaque token minted for this claim; presented back on settle.
   */
  static won(claimToken: string): ClaimResult {
    return new ClaimResult(true, undefined, claimToken);
  }

  /** Creates a result indicating a record already existed (the message is a duplicate). */
  static alreadyExists(existing: IdempotencyRecord): ClaimResult {
    return new ClaimResult(false, existing, undefined);
  }
}

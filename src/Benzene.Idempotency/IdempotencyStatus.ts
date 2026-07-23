/**
 * Lifecycle state of an idempotency record in an {@link IIdempotencyStore}.
 * Port of Benzene.Idempotency.IdempotencyStatus.
 */
export enum IdempotencyStatus {
  /**
   * The key has been claimed and the message is currently being processed (or the processing instance
   * crashed without releasing it, in which case the record lingers until it expires).
   */
  InProgress = 0,

  /**
   * Processing finished and the outcome has been recorded. Subsequent redeliveries of the same key are
   * duplicates and are short-circuited.
   */
  Completed = 1,
}

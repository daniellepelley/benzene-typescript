/**
 * How the middleware treats a duplicate that arrives while the first copy is still
 * {@link IdempotencyStatus.InProgress} (a genuinely concurrent redelivery, or a record left behind by
 * an instance that crashed mid-processing).
 * Port of Benzene.Idempotency.InProgressBehavior.
 */
export enum InProgressBehavior {
  /**
   * Drop the duplicate without invoking the handler and let the transport acknowledge it. The first
   * copy is expected to complete (or release on failure). This is the default: it never
   * double-processes, at the cost of dropping the duplicate if the first copy ultimately fails before
   * releasing its claim.
   */
  Skip = 0,

  /**
   * Throw {@link IdempotencyConflictException} so the transport does not acknowledge the duplicate and
   * redelivers it later, by which time the first copy has usually finished. Use this when losing a
   * duplicate whose sibling later fails is unacceptable.
   */
  Throw = 1,
}

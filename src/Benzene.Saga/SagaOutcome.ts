/**
 * The overall outcome of running a {@link Saga}.
 * Port of Benzene.Saga.SagaOutcome.
 */
export enum SagaOutcome {
  /** Every stage completed successfully. */
  Succeeded = 0,

  /**
   * A stage failed and every effect created by earlier (and concurrently-succeeded) steps was
   * successfully compensated - the system is back to its starting state and the saga can be retried.
   */
  RolledBack = 1,

  /**
   * A stage failed and rollback ran, but at least one compensation itself failed - the system may be
   * left with orphaned effects that need manual attention. See {@link SagaResult.compensationFailures}.
   */
  PartiallyRolledBack = 2,
}

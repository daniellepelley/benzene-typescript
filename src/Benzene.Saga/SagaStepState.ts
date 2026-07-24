/**
 * The lifecycle state of a single {@link ISagaStep} within a saga run.
 * Port of Benzene.Saga.SagaStepState.
 */
export enum SagaStepState {
  /** The step has not run yet. */
  Pending = 0,

  /** The step's forward action ran and returned a successful result. */
  Succeeded = 1,

  /** The step's forward action ran and returned a failed result (or threw). */
  Failed = 2,

  /** The step had succeeded and its compensation ran successfully during rollback. */
  RolledBack = 3,

  /**
   * The step had succeeded but its compensation itself failed (or threw) during rollback - the effect
   * this step created may still exist and needs attention.
   */
  CompensationFailed = 4,
}

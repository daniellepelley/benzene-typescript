/**
 * Identifying details of one saga run attempt, passed to an {@link ISagaStateStore} when the attempt
 * starts.
 * Port of Benzene.Saga.SagaRunInfo.
 */
export class SagaRunInfo {
  /** The saga instance id (stable across a run's retry attempts). */
  readonly sagaId: string;

  /** A human-readable saga name, for grouping/reporting. */
  readonly name: string;

  /** The 1-based attempt number. */
  readonly attempt: number;

  /** The number of stages in the saga. */
  readonly stageCount: number;

  constructor(sagaId: string, name: string, attempt: number, stageCount: number) {
    this.sagaId = sagaId;
    this.name = name;
    this.attempt = attempt;
    this.stageCount = stageCount;
  }
}

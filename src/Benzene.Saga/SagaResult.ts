import { IBenzeneResult } from '@benzenejs/abstractions';
import { ISagaStep } from './ISagaStep';
import { SagaOutcome } from './SagaOutcome';

/**
 * The outcome of running a {@link Saga}: whether it succeeded, and if not, which stage failed, why, and
 * whether rollback was clean.
 * Port of Benzene.Saga.SagaResult.
 */
export class SagaResult {
  /** The overall outcome. */
  readonly outcome: SagaOutcome;

  /** The zero-based index of the stage that failed, or `undefined` if the saga succeeded. */
  readonly failedStageIndex: number | undefined;

  /** The failing step's result, or `undefined` if the saga succeeded. */
  readonly failure: IBenzeneResult | undefined;

  /** The error the failing step threw, if it threw rather than returning a failed result. */
  readonly failureException: unknown;

  /**
   * The steps whose compensation itself failed during rollback - non-empty only when {@link outcome} is
   * {@link SagaOutcome.PartiallyRolledBack}. Their effects may still exist and need manual attention.
   */
  readonly compensationFailures: readonly ISagaStep[];

  /**
   * Every step that failed within the failing stage - non-empty only when the saga failed
   * ({@link outcome} is {@link SagaOutcome.RolledBack} or {@link SagaOutcome.PartiallyRolledBack}), and
   * containing more than one entry exactly when more than one step in that stage failed concurrently (a
   * normal outcome - a stage's steps all run concurrently and are all awaited before the stage is judged
   * failed). Mirrors how {@link compensationFailures} already surfaces every relevant step as a list,
   * rather than only one. Port of .NET's additive `SagaResult.Failures` (#209).
   *
   * {@link failure}/{@link failureException} mirror this list's first item and remain populated exactly
   * as before - kept for compatibility with code written against the single-failure shape. Prefer this
   * list when more than one step in the same stage can fail concurrently and every failure matters, not
   * just the first one observed.
   */
  readonly failures: readonly ISagaStep[];

  /**
   * The error a configured {@link import('./ISagaStateStore').ISagaStateStore} call threw during this
   * attempt (recording the start, a stage completion, or the finish), or `undefined` if no store is
   * configured or every store call this attempt succeeded. Port of .NET's additive
   * `SagaResult.StateStoreFailure` (#208/#257).
   *
   * A populated value here does NOT mean the saga's own steps failed - {@link outcome},
   * {@link failures}, and {@link compensationFailures} all reflect the saga's real forward/rollback
   * progress independent of whether the store durably recorded it. A state-store failure never aborts
   * the saga's own execution and never suppresses rollback for effects already applied. In particular, a
   * {@link SagaOutcome.Succeeded} result with this populated means the saga genuinely succeeded but that
   * outcome was not durably recorded - a caller that blindly retried on any thrown error would otherwise
   * have re-run an already-succeeded saga with no compensation and no dedup.
   */
  readonly stateStoreFailure: unknown;

  /**
   * @param failures Every step that failed within the failing stage (see {@link failures}). Optional and
   * additive - defaults to empty when not supplied, e.g. by a caller built against the pre-#209
   * constructor shape.
   * @param stateStoreFailure The error a configured state-store call threw during this attempt, if any
   * (see {@link stateStoreFailure}). Optional and additive - defaults to `undefined`.
   */
  constructor(
    outcome: SagaOutcome,
    failedStageIndex: number | undefined,
    failure: IBenzeneResult | undefined,
    failureException: unknown,
    compensationFailures: readonly ISagaStep[],
    failures: readonly ISagaStep[] = [],
    stateStoreFailure: unknown = undefined,
  ) {
    this.outcome = outcome;
    this.failedStageIndex = failedStageIndex;
    this.failure = failure;
    this.failureException = failureException;
    this.compensationFailures = compensationFailures;
    this.failures = failures;
    this.stateStoreFailure = stateStoreFailure;
  }

  /** Whether the saga completed successfully. */
  get isSuccess(): boolean {
    return this.outcome === SagaOutcome.Succeeded;
  }
}

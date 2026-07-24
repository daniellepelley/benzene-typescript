import { IBenzeneResult } from '@benzene/abstractions';
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

  constructor(
    outcome: SagaOutcome,
    failedStageIndex: number | undefined,
    failure: IBenzeneResult | undefined,
    failureException: unknown,
    compensationFailures: readonly ISagaStep[],
  ) {
    this.outcome = outcome;
    this.failedStageIndex = failedStageIndex;
    this.failure = failure;
    this.failureException = failureException;
    this.compensationFailures = compensationFailures;
  }

  /** Whether the saga completed successfully. */
  get isSuccess(): boolean {
    return this.outcome === SagaOutcome.Succeeded;
  }
}

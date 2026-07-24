import { IBenzeneResult } from '@benzene/abstractions';
import { SagaContext } from './SagaContext';
import { SagaStepState } from './SagaStepState';

/**
 * A single unit of work in a saga: a forward action paired with an optional compensation that undoes
 * it. Steps are grouped into stages (run concurrently) which are grouped into a {@link Saga} (run in
 * order). The non-generic surface is what the engine operates on; the result type is captured by
 * {@link SagaStep}.
 * Port of Benzene.Saga.ISagaStep.
 */
export interface ISagaStep {
  /** The current lifecycle state of this step. */
  readonly state: SagaStepState;

  /** The forward action's result once it has run, or `undefined` before it runs. Used for failure reporting. */
  readonly result: IBenzeneResult | undefined;

  /** The error the forward action threw, if it threw rather than returning a failed result; otherwise `undefined`. */
  readonly exception: unknown;

  /**
   * Runs the forward action, reading any earlier-stage values it needs from `context`, and records the
   * outcome onto {@link state}/{@link result}. Does not publish its own result to the context - that
   * happens via {@link publish} once the whole stage succeeds.
   */
  executeAsync(context: SagaContext): Promise<void>;

  /**
   * Publishes this step's successful result into `context` so later stages can read it. Called only
   * after the step's stage has fully succeeded (a no-op unless the step declared a context key).
   */
  publish(context: SagaContext): void;

  /**
   * Compensates this step during rollback. A no-op that reports success if the step did not succeed or
   * has no compensation.
   * @returns `true` if there was nothing to undo or the compensation succeeded; `false` if the
   * compensation itself failed.
   */
  compensateAsync(context: SagaContext): Promise<boolean>;
}

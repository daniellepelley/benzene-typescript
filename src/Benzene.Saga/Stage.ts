import { ISagaStep } from './ISagaStep';
import { SagaContext } from './SagaContext';
import { SagaStepState } from './SagaStepState';

/**
 * A group of {@link ISagaStep}s that run concurrently as one all-or-nothing unit within a {@link Saga}.
 * The stage succeeds only if every step succeeds.
 * Port of Benzene.Saga.Stage.
 */
export class Stage {
  /** The steps in this stage. */
  readonly steps: readonly ISagaStep[];

  constructor(steps: readonly ISagaStep[]) {
    this.steps = steps;
  }

  /**
   * Runs every step's forward action concurrently (awaiting them all, even if one fails early) and
   * returns whether the whole stage succeeded.
   */
  async executeAsync(context: SagaContext): Promise<boolean> {
    await Promise.all(this.steps.map((step) => step.executeAsync(context)));
    return this.steps.every((step) => step.state === SagaStepState.Succeeded);
  }

  /** Publishes every succeeded step's result into the context. Call only after the stage fully succeeds. */
  publish(context: SagaContext): void {
    for (const step of this.steps) {
      step.publish(context);
    }
  }

  /**
   * Compensates this stage's succeeded steps concurrently (best effort - every compensation is attempted
   * regardless of whether an earlier one failed).
   * @returns `true` if every compensation succeeded (or there was nothing to undo); otherwise `false`.
   */
  async compensateAsync(context: SagaContext): Promise<boolean> {
    const results = await Promise.all(this.steps.map((step) => step.compensateAsync(context)));
    return results.every((ok) => ok);
  }
}

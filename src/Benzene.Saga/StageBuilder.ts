import { ISagaStep } from './ISagaStep';
import { Stage } from './Stage';
import { StepBuilder } from './StepBuilder';

/**
 * Fluent builder for a stage - a group of steps that run concurrently as one all-or-nothing unit.
 * Port of Benzene.Saga.StageBuilder.
 */
export class StageBuilder {
  private readonly steps: ISagaStep[] = [];

  /** Adds a step producing a `T` result to this stage. */
  step<T>(configure: (builder: StepBuilder<T>) => void): this {
    const stepBuilder = new StepBuilder<T>();
    configure(stepBuilder);
    this.steps.push(stepBuilder.build());
    return this;
  }

  build(): Stage {
    if (this.steps.length === 0) {
      throw new Error('A saga stage requires at least one step.');
    }

    return new Stage(this.steps);
  }
}

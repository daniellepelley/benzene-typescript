import { Saga } from './Saga';
import { Stage } from './Stage';
import { StageBuilder } from './StageBuilder';

/**
 * Fluent builder for a {@link Saga} - an ordered list of stages.
 * Port of Benzene.Saga.SagaBuilder.
 */
export class SagaBuilder {
  private readonly stages: Stage[] = [];

  /**
   * Adds a stage to the saga. Stages run in the order they are added; a later stage can read an earlier
   * stage's results from the {@link SagaContext}.
   */
  stage(configure: (builder: StageBuilder) => void): this {
    const stageBuilder = new StageBuilder();
    configure(stageBuilder);
    this.stages.push(stageBuilder.build());
    return this;
  }

  /**
   * Builds the saga.
   * @throws Error if no stages were added.
   */
  build(): Saga {
    if (this.stages.length === 0) {
      throw new Error('A saga requires at least one stage.');
    }

    return new Saga(this.stages);
  }
}

import { ISagaStep } from './ISagaStep';
import { SagaCompensate, SagaForward, SagaStep } from './SagaStep';

/**
 * Fluent builder for a single saga step producing a `T` result.
 * Port of Benzene.Saga.StepBuilder&lt;T&gt;.
 */
export class StepBuilder<T> {
  private forwardAction: SagaForward<T> | undefined;
  private compensationAction: SagaCompensate<T> | undefined;
  private contextKey: string | undefined;

  /**
   * Sets the forward action - typically a message-sender send, which already returns an
   * `IBenzeneResultOf<T>`, but any async action returning one works.
   */
  do(forward: SagaForward<T>): this {
    this.forwardAction = forward;
    return this;
  }

  /**
   * Sets the compensation that undoes the forward action, given the saga context and the forward result.
   * Omit for a step that creates no effect to undo.
   */
  compensate(compensate: SagaCompensate<T>): this {
    this.compensationAction = compensate;
    return this;
  }

  /**
   * Sets the explicit context key to publish this step's result under, so a later stage can read it by
   * that key. A step with no key does not publish its result. (In the .NET original the key defaulted to
   * the result's type; TypeScript's erased generics make an explicit key the only option - see
   * {@link SagaContext}.)
   */
  key(key: string): this {
    this.contextKey = key;
    return this;
  }

  build(): ISagaStep {
    if (this.forwardAction === undefined) {
      throw new Error('A saga step requires a forward action - call do(...).');
    }

    return new SagaStep<T>(this.forwardAction, this.compensationAction, this.contextKey);
  }
}

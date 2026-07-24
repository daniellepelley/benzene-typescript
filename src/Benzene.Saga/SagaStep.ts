import { IBenzeneResult, IBenzeneResultOf } from '@benzene/abstractions';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import { ISagaStep } from './ISagaStep';
import { SagaContext } from './SagaContext';
import { SagaStepState } from './SagaStepState';

/** A saga step's forward action: produces a typed result from the saga context. */
export type SagaForward<T> = (context: SagaContext) => Promise<IBenzeneResultOf<T>>;

/** A saga step's compensation: undoes the effect, given the context and the forward result. */
export type SagaCompensate<T> = (context: SagaContext, payload: T) => Promise<IBenzeneResult>;

/**
 * A saga step whose forward action produces a `T` result, with an optional compensation that undoes the
 * effect using that result.
 * Port of Benzene.Saga.SagaStep&lt;T&gt;.
 */
export class SagaStep<T> implements ISagaStep {
  private readonly forward: SagaForward<T>;
  private readonly compensate: SagaCompensate<T> | undefined;
  private readonly key: string | undefined;
  private innerResult: IBenzeneResultOf<T> | undefined;

  private innerState: SagaStepState = SagaStepState.Pending;
  private innerException: unknown;

  /**
   * @param forward The forward action, run with the saga context.
   * @param compensate The optional compensation, given the context and the forward result; omit for a step with no effect to undo.
   * @param key An optional explicit context key to publish the result under (see {@link SagaContext}).
   */
  constructor(forward: SagaForward<T>, compensate?: SagaCompensate<T>, key?: string) {
    this.forward = forward;
    this.compensate = compensate;
    this.key = key;
  }

  get state(): SagaStepState {
    return this.innerState;
  }

  get result(): IBenzeneResult | undefined {
    return this.innerResult;
  }

  get exception(): unknown {
    return this.innerException;
  }

  async executeAsync(context: SagaContext): Promise<void> {
    // Reset per run: a step instance is reused across retry attempts, so an exception left over from an
    // earlier attempt would otherwise still be reported as this attempt's failureException even when this
    // attempt failed by returning a failed result rather than throwing.
    this.innerException = undefined;
    try {
      this.innerResult = await this.forward(context);
      this.innerState = this.innerResult.isSuccessful ? SagaStepState.Succeeded : SagaStepState.Failed;
    } catch (error) {
      this.innerException = error;
      this.innerResult = BenzeneResult.set<T>(BenzeneResultStatus.unexpectedError, undefined, false);
      this.innerState = SagaStepState.Failed;
    }
  }

  publish(context: SagaContext): void {
    if (this.innerState === SagaStepState.Succeeded && this.innerResult !== undefined && this.key !== undefined) {
      context.set(this.key, this.innerResult.payload);
    }
  }

  async compensateAsync(context: SagaContext): Promise<boolean> {
    // Only a step that actually succeeded created an effect worth undoing.
    if (this.innerState !== SagaStepState.Succeeded) {
      return true;
    }

    // A succeeded step with no compensation is treated as "nothing to undo" - author a compensation for
    // any step that creates a side effect.
    if (this.compensate === undefined) {
      this.innerState = SagaStepState.RolledBack;
      return true;
    }

    try {
      const compensationResult = await this.compensate(context, this.innerResult!.payload);
      if (compensationResult.isSuccessful) {
        this.innerState = SagaStepState.RolledBack;
        return true;
      }
    } catch (error) {
      this.innerException = error;
    }

    this.innerState = SagaStepState.CompensationFailed;
    return false;
  }
}

import { randomUUID } from 'node:crypto';
import { ISagaStep } from './ISagaStep';
import { SagaContext } from './SagaContext';
import { SagaOutcome } from './SagaOutcome';
import { SagaResult } from './SagaResult';
import { SagaRunInfo } from './SagaRunInfo';
import { SagaRunOptions } from './SagaRunOptions';
import { SagaStepState } from './SagaStepState';
import { Stage } from './Stage';

/**
 * An in-code orchestrator for a distributed transaction: an ordered list of stages, each a group of
 * steps run concurrently. Runs stages in order, threading each stage's results into a shared
 * {@link SagaContext} for later stages; if any stage fails, every effect created so far is compensated
 * in reverse order, leaving the system back at its starting state so the saga can be retried. It is
 * all-or-nothing: it either completes in full or rolls back in full.
 * Port of Benzene.Saga.Saga. Normally built via {@link SagaBuilder}.
 */
export class Saga {
  private readonly stages: readonly Stage[];

  constructor(stages: readonly Stage[]) {
    this.stages = stages;
  }

  /**
   * Runs the saga. With no options, executes each stage in order once; on the first stage failure,
   * compensates every completed effect in reverse (last-in, first-out) order and returns a rolled-back
   * result. With a {@link SagaRunOptions.retryPolicy}, a *clean* rollback is re-run (from scratch) up to
   * the policy's attempt limit; a success, or a {@link SagaOutcome.PartiallyRolledBack} outcome (which
   * may have left effects), is never retried. With a {@link SagaRunOptions.stateStore}, progress and
   * outcome are recorded per attempt.
   */
  async runAsync(options: SagaRunOptions = new SagaRunOptions()): Promise<SagaResult> {
    const policy = options.retryPolicy;
    const maxAttempts = policy?.maxAttempts ?? 1;
    let delayMs = policy?.initialDelayMs ?? 0;

    // A single, stable id shared across every attempt of this run.
    const sagaId = options.sagaId ?? (options.stateStore !== undefined ? randomUUID() : undefined);

    let result: SagaResult = new SagaResult(SagaOutcome.Succeeded, undefined, undefined, undefined, []);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      result = await this.runOnceAsync(options, attempt, sagaId);

      // Only a clean rollback is safe to retry; stop otherwise or when attempts are exhausted.
      if (result.outcome !== SagaOutcome.RolledBack || attempt === maxAttempts) {
        return result;
      }

      if (delayMs > 0) {
        await policy!.delay(delayMs);
        delayMs = delayMs * policy!.backoffFactor;
      }
    }

    return result;
  }

  private async runOnceAsync(
    options: SagaRunOptions,
    attempt: number,
    sagaId?: string,
  ): Promise<SagaResult> {
    const store = options.stateStore;
    let id = sagaId;
    if (store !== undefined) {
      id ??= options.sagaId ?? randomUUID();
      await store.recordStartedAsync(new SagaRunInfo(id, options.name, attempt, this.stages.length));
    }

    const context = new SagaContext();
    const completedStages: Stage[] = [];

    for (let i = 0; i < this.stages.length; i++) {
      const stage = this.stages[i];

      if (await stage.executeAsync(context)) {
        stage.publish(context);
        completedStages.push(stage);
        if (store !== undefined) {
          await store.recordStageCompletedAsync(id!, attempt, i);
        }

        continue;
      }

      // Stage i failed. Roll back this stage's concurrently-succeeded steps first, then every completed
      // stage newest-first, so effects are undone in the reverse of the order they were created.
      const rollbackClean = await Saga.rollBackAsync(context, completedStages, stage);

      const failedStep = stage.steps.find((step) => step.state === SagaStepState.Failed);
      const compensationFailures = Saga.collectCompensationFailures(completedStages, stage);

      const failure = new SagaResult(
        rollbackClean ? SagaOutcome.RolledBack : SagaOutcome.PartiallyRolledBack,
        i,
        failedStep?.result,
        failedStep?.exception,
        compensationFailures,
      );

      if (store !== undefined) {
        await store.recordFinishedAsync(id!, attempt, failure);
      }

      return failure;
    }

    const success = new SagaResult(SagaOutcome.Succeeded, undefined, undefined, undefined, []);
    if (store !== undefined) {
      await store.recordFinishedAsync(id!, attempt, success);
    }

    return success;
  }

  private static async rollBackAsync(
    context: SagaContext,
    completedStages: Stage[],
    failedStage: Stage,
  ): Promise<boolean> {
    let clean = await failedStage.compensateAsync(context);

    for (let j = completedStages.length - 1; j >= 0; j--) {
      const stageClean = await completedStages[j].compensateAsync(context);
      clean = clean && stageClean;
    }

    return clean;
  }

  private static collectCompensationFailures(
    completedStages: Stage[],
    failedStage: Stage,
  ): ISagaStep[] {
    return [...completedStages, failedStage]
      .flatMap((stage) => [...stage.steps])
      .filter((step) => step.state === SagaStepState.CompensationFailed);
  }
}

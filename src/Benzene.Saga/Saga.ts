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

    // #208/#257: a state-store call failing must never abort the saga's own execution, never skip
    // rollback for effects already applied, and never replace a genuinely successful/rolled-back
    // result with a raw error - it is surfaced on the returned SagaResult instead (see
    // stateStoreFailure's doc). Every store call below goes through recordSafelyAsync for exactly that
    // reason. Only the FIRST failure this attempt is kept (a store failing once is usually failing
    // consistently; the earliest failure is the most informative), but every call is still attempted
    // regardless of an earlier one having failed.
    let stateStoreFailure: unknown = undefined;

    let id = sagaId;
    if (store !== undefined) {
      id ??= options.sagaId ?? randomUUID();
      const runInfo = new SagaRunInfo(id, options.name, attempt, this.stages.length);
      const startError = await Saga.recordSafelyAsync(() => store.recordStartedAsync(runInfo));
      stateStoreFailure ??= startError;
    }

    const context = new SagaContext();
    const completedStages: Stage[] = [];

    for (let i = 0; i < this.stages.length; i++) {
      const stage = this.stages[i];

      if (await stage.executeAsync(context)) {
        stage.publish(context);
        completedStages.push(stage);
        if (store !== undefined) {
          const stageError = await Saga.recordSafelyAsync(() =>
            store.recordStageCompletedAsync(id!, attempt, i),
          );
          stateStoreFailure ??= stageError;
        }

        continue;
      }

      // Stage i failed. Roll back this stage's concurrently-succeeded steps first, then every completed
      // stage newest-first, so effects are undone in the reverse of the order they were created. Runs
      // unconditionally - even if a state-store call already failed above - so a store outage can never
      // suppress compensation for effects genuinely applied (#208).
      const rollbackClean = await Saga.rollBackAsync(context, completedStages, stage);

      // #209: every concurrently-failed step in the failing stage, not just the first one observed.
      const failures = stage.steps.filter((step) => step.state === SagaStepState.Failed);
      const failedStep = failures[0];
      const compensationFailures = Saga.collectCompensationFailures(completedStages, stage);
      const outcome = rollbackClean ? SagaOutcome.RolledBack : SagaOutcome.PartiallyRolledBack;

      if (store !== undefined) {
        // Hand the store the outcome as known so far (any earlier store hiccup this attempt included);
        // if THIS call also throws, that's folded into the returned result below rather than
        // propagated - #208's failure-path variant: recordFinishedAsync itself failing after rollback
        // already ran must not lose compensationFailures visibility.
        const recorded = new SagaResult(
          outcome,
          i,
          failedStep?.result,
          failedStep?.exception,
          compensationFailures,
          failures,
          stateStoreFailure,
        );
        const finishError = await Saga.recordSafelyAsync(() =>
          store.recordFinishedAsync(id!, attempt, recorded),
        );
        stateStoreFailure ??= finishError;
      }

      return new SagaResult(
        outcome,
        i,
        failedStep?.result,
        failedStep?.exception,
        compensationFailures,
        failures,
        stateStoreFailure,
      );
    }

    if (store !== undefined) {
      const recorded = new SagaResult(
        SagaOutcome.Succeeded,
        undefined,
        undefined,
        undefined,
        [],
        [],
        stateStoreFailure,
      );
      const finishError = await Saga.recordSafelyAsync(() =>
        store.recordFinishedAsync(id!, attempt, recorded),
      );
      stateStoreFailure ??= finishError;
    }

    // #257: even if recordFinishedAsync just threw (or an earlier store call did), every stage
    // genuinely succeeded - return that success, with the store failure surfaced, rather than letting a
    // raw error replace it (which would risk a caller retrying an already-succeeded saga with no
    // compensation and no dedup).
    return new SagaResult(
      SagaOutcome.Succeeded,
      undefined,
      undefined,
      undefined,
      [],
      [],
      stateStoreFailure,
    );
  }

  /**
   * Runs a state-store call, catching any error it throws instead of letting it propagate - see
   * {@link runOnceAsync}'s remarks on why a store failure must never abort the saga's own execution or
   * replace its real outcome. Returns the caught error, or `undefined` when the call succeeded.
   */
  private static async recordSafelyAsync(storeCall: () => Promise<void>): Promise<unknown> {
    try {
      await storeCall();
      return undefined;
    } catch (error) {
      // `undefined` doubles as "no failure" for the `??=` threading above, so a store that throws a
      // literal `undefined` is normalized to a real Error rather than silently dropped.
      return error ?? new Error('The saga state store threw a nullish error.');
    }
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

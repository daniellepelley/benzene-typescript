import { SagaResult } from './SagaResult';
import { SagaRunInfo } from './SagaRunInfo';

/**
 * A pluggable sink for a saga's progress and outcome, so a crashed or rolled-back saga's last known
 * state is durably recorded - most importantly a {@link SagaOutcome.PartiallyRolledBack} outcome, whose
 * orphaned effects need an operator to see them.
 * Port of Benzene.Saga.ISagaStateStore.
 *
 * This records progress; it does not *resume* a saga (the engine's steps are in-process closures). The
 * engine calls these methods in order - {@link recordStartedAsync}, then {@link recordStageCompletedAsync}
 * per completed stage, then {@link recordFinishedAsync} - once per attempt. C# `CancellationToken` maps
 * to an optional `AbortSignal`.
 */
export interface ISagaStateStore {
  /** Records that a saga run attempt has started. */
  recordStartedAsync(run: SagaRunInfo, signal?: AbortSignal): Promise<void>;

  /** Records that a stage completed successfully within an attempt. */
  recordStageCompletedAsync(
    sagaId: string,
    attempt: number,
    stageIndex: number,
    signal?: AbortSignal,
  ): Promise<void>;

  /** Records the final outcome of an attempt. */
  recordFinishedAsync(
    sagaId: string,
    attempt: number,
    result: SagaResult,
    signal?: AbortSignal,
  ): Promise<void>;
}

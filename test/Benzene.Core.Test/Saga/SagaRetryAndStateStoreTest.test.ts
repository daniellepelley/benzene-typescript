import { describe, expect, it } from 'vitest';
import { IBenzeneResult, IBenzeneResultOf } from '@benzenejs/abstractions';
import { BenzeneResult } from '@benzenejs/results';
import {
  InMemorySagaStateStore,
  ISagaStateStore,
  SagaBuilder,
  SagaOutcome,
  SagaResult,
  SagaRetryPolicy,
  SagaRunInfo,
  SagaRunOptions,
  SagaStateEvent,
  SagaStateEventKind,
} from '@benzenejs/saga';

/**
 * Port of test/Benzene.Core.Test/Saga/SagaRetryAndStateStoreTest.cs: the optional whole-saga retry
 * policy and the pluggable ISagaStateStore.
 */

const ok = (value: string): Promise<IBenzeneResultOf<string>> => Promise.resolve(BenzeneResult.ok(value));
const fail = (): Promise<IBenzeneResultOf<string>> => Promise.resolve(BenzeneResult.serviceUnavailable<string>());
const undo = (): Promise<IBenzeneResult> => Promise.resolve(BenzeneResult.ok());

/** A retry policy with no real delay, for fast deterministic tests. */
function fastRetry(maxAttempts: number): SagaRetryPolicy {
  return new SagaRetryPolicy(maxAttempts, 0, 2, () => Promise.resolve());
}

function options(overrides: Partial<SagaRunOptions>): SagaRunOptions {
  return Object.assign(new SagaRunOptions(), overrides);
}

describe('Saga retry', () => {
  it('re-runs after a clean rollback and succeeds once the flaky step recovers', async () => {
    let attempts = 0;
    const saga = new SagaBuilder()
      .stage((s) => s.step<string>((step) => step.do(() => ok('a')).compensate(() => undo())))
      .stage((s) =>
        s.step<string>((step) =>
          step.do(() => {
            attempts += 1;
            return attempts < 2 ? fail() : ok('b'); // fails first attempt, succeeds on the second
          }),
        ),
      )
      .build();

    const result = await saga.runAsync(options({ retryPolicy: fastRetry(3) }));

    expect(result.outcome).toBe(SagaOutcome.Succeeded);
    expect(attempts).toBe(2);
  });

  it('exhausts attempts and returns RolledBack', async () => {
    let attempts = 0;
    const saga = new SagaBuilder()
      .stage((s) =>
        s.step<string>((step) =>
          step.do(() => {
            attempts += 1;
            return fail();
          }),
        ),
      )
      .build();

    const result = await saga.runAsync(options({ retryPolicy: fastRetry(3) }));

    expect(result.outcome).toBe(SagaOutcome.RolledBack);
    expect(attempts).toBe(3); // tried the configured maximum
  });

  it('does not retry on PartiallyRolledBack', async () => {
    // Stage 1 succeeds but its compensation fails; stage 2 fails -> rollback is not clean.
    let forwardAttempts = 0;
    const saga = new SagaBuilder()
      .stage((s) =>
        s.step<string>((step) => step.do(() => ok('a')).compensate(() => Promise.resolve(BenzeneResult.serviceUnavailable()))),
      ) // compensation fails
      .stage((s) =>
        s.step<string>((step) =>
          step.do(() => {
            forwardAttempts += 1;
            return fail();
          }),
        ),
      )
      .build();

    const result = await saga.runAsync(options({ retryPolicy: fastRetry(5) }));

    expect(result.outcome).toBe(SagaOutcome.PartiallyRolledBack);
    expect(forwardAttempts).toBe(1); // not retried - orphaned effects must not be re-applied
  });
});

describe('Saga state store', () => {
  it('records start, each stage completion, and a successful finish', async () => {
    const store = new InMemorySagaStateStore();
    const saga = new SagaBuilder()
      .stage((s) => s.step<string>((step) => step.do(() => ok('a'))))
      .stage((s) => s.step<string>((step) => step.do(() => ok('b'))))
      .build();

    await saga.runAsync(options({ sagaId: 'saga-1', stateStore: store }));

    const kinds = store.eventsFor('saga-1').map((e) => e.kind);
    expect(kinds).toEqual([
      SagaStateEventKind.Started,
      SagaStateEventKind.StageCompleted,
      SagaStateEventKind.StageCompleted,
      SagaStateEventKind.Finished,
    ]);

    const finished = store.eventsFor('saga-1').find((e) => e.kind === SagaStateEventKind.Finished);
    expect(finished!.result!.outcome).toBe(SagaOutcome.Succeeded);
  });

  it('on failure records only completed stages and a rolled-back finish', async () => {
    const store = new InMemorySagaStateStore();
    const saga = new SagaBuilder()
      .stage((s) => s.step<string>((step) => step.do(() => ok('a')).compensate(() => undo())))
      .stage((s) => s.step<string>((step) => step.do(() => fail())))
      .build();

    await saga.runAsync(options({ sagaId: 'saga-2', stateStore: store }));

    const events = store.eventsFor('saga-2');
    const stageCompletions = events.filter((e) => e.kind === SagaStateEventKind.StageCompleted);
    expect(stageCompletions).toHaveLength(1); // only stage 0
    expect(stageCompletions[0]!.stageIndex).toBe(0);
    expect(events.find((e) => e.kind === SagaStateEventKind.Finished)!.result!.outcome).toBe(SagaOutcome.RolledBack);
  });

  it('records each retry attempt', async () => {
    const store = new InMemorySagaStateStore();
    let attempts = 0;
    const saga = new SagaBuilder()
      .stage((s) =>
        s.step<string>((step) =>
          step.do(() => {
            attempts += 1;
            return attempts < 2 ? fail() : ok('a');
          }),
        ),
      )
      .build();

    await saga.runAsync(options({ sagaId: 'saga-3', stateStore: store, retryPolicy: fastRetry(3) }));

    const startedAttempts = store
      .eventsFor('saga-3')
      .filter((e) => e.kind === SagaStateEventKind.Started)
      .map((e) => e.attempt);
    expect(startedAttempts).toEqual([1, 2]); // one Started per attempt, sharing the saga id
  });

  it('generates a saga id when none supplied', async () => {
    const store = new InMemorySagaStateStore();
    const saga = new SagaBuilder().stage((s) => s.step<string>((step) => step.do(() => ok('a')))).build();

    await saga.runAsync(options({ stateStore: store }));

    expect(store.events.length).toBeGreaterThan(0);
    expect(store.events[0]!.sagaId).not.toBe('');
  });

  it('a parameterless run touches no store and behaves as before', async () => {
    const saga = new SagaBuilder().stage((s) => s.step<string>((step) => step.do(() => ok('a')))).build();

    const result = await saga.runAsync();

    expect(result.outcome).toBe(SagaOutcome.Succeeded);
  });
});

// ---- State-store failure handling (#208, #257) ----------------------------------------------------

/**
 * Wraps a real InMemorySagaStateStore so a test can make one specific call throw (a real store failure,
 * not the store simply being absent) while every other call still records normally - used to prove
 * #208/#257's fix: the saga's own outcome/rollback must never be lost or aborted by a state-store
 * failure, and the failure itself must be surfaced via `SagaResult.stateStoreFailure` rather than
 * propagating as a raw error out of `runAsync`.
 */
class ThrowingSagaStateStore implements ISagaStateStore {
  private readonly inner = new InMemorySagaStateStore();

  throwOnRecordStageCompleted = false;
  throwOnRecordFinished = false;

  get events(): readonly SagaStateEvent[] {
    return this.inner.events;
  }

  recordStartedAsync(run: SagaRunInfo, signal?: AbortSignal): Promise<void> {
    return this.inner.recordStartedAsync(run, signal);
  }

  recordStageCompletedAsync(
    sagaId: string,
    attempt: number,
    stageIndex: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.throwOnRecordStageCompleted) {
      throw new Error('simulated state store failure recording stage completion');
    }

    return this.inner.recordStageCompletedAsync(sagaId, attempt, stageIndex, signal);
  }

  recordFinishedAsync(
    sagaId: string,
    attempt: number,
    result: SagaResult,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.throwOnRecordFinished) {
      throw new Error('simulated state store failure recording finish');
    }

    return this.inner.recordFinishedAsync(sagaId, attempt, result, signal);
  }
}

describe('Saga state-store failure handling', () => {
  it('a store throwing after an effect-producing stage completes still rolls back and surfaces the failure', async () => {
    // #208: a state-store failure occurring right after an effect-producing stage completes must not
    // abort the run with zero rollback - a later stage's failure must still compensate the earlier
    // stage's genuinely-applied effect, and the store failure is surfaced on the result, not thrown.
    const log: string[] = [];
    const store = new ThrowingSagaStateStore();
    store.throwOnRecordStageCompleted = true;
    const saga = new SagaBuilder()
      .stage((s) =>
        s.step<string>((step) =>
          step
            .do(() => {
              log.push('s1');
              return ok('a');
            })
            .compensate(() => {
              log.push('undo-s1');
              return undo();
            }),
        ),
      )
      .stage((s) => s.step<string>((step) => step.do(() => fail())))
      .build();

    const result = await saga.runAsync(options({ sagaId: 'saga-208', stateStore: store }));

    // The saga's own outcome is unaffected by the store failure - rollback still ran for the stage
    // that genuinely completed.
    expect(result.outcome).toBe(SagaOutcome.RolledBack);
    expect(log).toContain('undo-s1');

    // The store failure is surfaced, not swallowed and not thrown.
    expect(result.stateStoreFailure).toBeInstanceOf(Error);
    expect((result.stateStoreFailure as Error).message).toContain('recording stage completion');
  });

  it('a store throwing on the finish record after rollback still returns the compensation failures', async () => {
    // #208's failure-path variant: recordFinishedAsync itself throwing after rollback already ran
    // must not lose compensationFailures visibility - the computed result (including compensation
    // failures) must still come back, with the store failure added.
    const store = new ThrowingSagaStateStore();
    store.throwOnRecordFinished = true;
    const saga = new SagaBuilder()
      .stage((s) =>
        s.step<string>((step) =>
          step.do(() => ok('a')).compensate(() => Promise.resolve(BenzeneResult.serviceUnavailable())),
        ),
      ) // undo fails
      .stage((s) => s.step<string>((step) => step.do(() => fail())))
      .build();

    const result = await saga.runAsync(options({ sagaId: 'saga-208b', stateStore: store }));

    expect(result.outcome).toBe(SagaOutcome.PartiallyRolledBack);
    expect(result.compensationFailures).toHaveLength(1); // not lost despite the store also failing
    expect(result.stateStoreFailure).toBeInstanceOf(Error);
  });

  it('a store throwing on the finish record after full success still returns Succeeded', async () => {
    // #257: recordFinishedAsync throwing after every stage genuinely succeeded must not discard the
    // successful SagaResult - the caller must still learn the saga succeeded (so it does not blindly
    // retry an already-completed saga), with stateStoreFailure populated to show the store didn't
    // durably record it.
    const store = new ThrowingSagaStateStore();
    store.throwOnRecordFinished = true;
    const saga = new SagaBuilder().stage((s) => s.step<string>((step) => step.do(() => ok('a')))).build();

    const result = await saga.runAsync(options({ sagaId: 'saga-257', stateStore: store }));

    expect(result.outcome).toBe(SagaOutcome.Succeeded);
    expect(result.isSuccess).toBe(true);
    expect(result.stateStoreFailure).toBeInstanceOf(Error);
    expect((result.stateStoreFailure as Error).message).toContain('recording finish');
  });

  it('a store throwing on the finish record after full success does not trigger a retry', async () => {
    // A configured retry policy must not re-run an already-succeeded saga just because the store
    // failed to record it.
    const store = new ThrowingSagaStateStore();
    store.throwOnRecordFinished = true;
    let attempts = 0;
    const saga = new SagaBuilder()
      .stage((s) =>
        s.step<string>((step) =>
          step.do(() => {
            attempts += 1;
            return ok('a');
          }),
        ),
      )
      .build();

    const result = await saga.runAsync(
      options({ sagaId: 'saga-257b', stateStore: store, retryPolicy: fastRetry(3) }),
    );

    expect(result.outcome).toBe(SagaOutcome.Succeeded);
    expect(attempts).toBe(1); // succeeded on the first attempt - retry policy only fires on RolledBack
  });
});

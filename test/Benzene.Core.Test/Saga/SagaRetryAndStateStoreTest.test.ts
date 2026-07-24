import { describe, expect, it } from 'vitest';
import { IBenzeneResult, IBenzeneResultOf } from '@benzene/abstractions';
import { BenzeneResult } from '@benzene/results';
import {
  InMemorySagaStateStore,
  SagaBuilder,
  SagaOutcome,
  SagaRetryPolicy,
  SagaRunOptions,
  SagaStateEventKind,
} from '@benzene/saga';

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

import { describe, expect, it } from 'vitest';
import { IBenzeneResult, IBenzeneResultOf } from '@benzene/abstractions';
import { BenzeneResult } from '@benzene/results';
import { SagaBuilder, SagaOutcome, SagaStepState } from '@benzene/saga';

/**
 * Port of test/Benzene.Core.Test/Saga/SagaTest.cs. The one C# case that relied on the type-keyed
 * context (`ctx.Get<string>()`) is ported with an explicit key (`.key('tenant')` /
 * `ctx.get('tenant')`), the port's option-1 convention for `SagaContext`.
 */

function ok(log: string[], tag: string, value: string): Promise<IBenzeneResultOf<string>> {
  log.push(tag);
  return Promise.resolve(BenzeneResult.ok(value));
}

function fail(log: string[], tag: string): Promise<IBenzeneResultOf<string>> {
  log.push(tag);
  return Promise.resolve(BenzeneResult.serviceUnavailable<string>());
}

function undo(log: string[], tag: string, succeeds = true): Promise<IBenzeneResult> {
  log.push(tag);
  return Promise.resolve(succeeds ? BenzeneResult.ok() : BenzeneResult.serviceUnavailable());
}

describe('Saga', () => {
  it('all stages succeed - returns Succeeded and threads context forward', async () => {
    const log: string[] = [];

    const saga = new SagaBuilder()
      .stage((stage) =>
        stage.step<string>((step) =>
          step.do(() => ok(log, 'create-tenant', 'tenant-1')).key('tenant').compensate((_, r) => undo(log, `undo-tenant:${r}`)),
        ),
      )
      .stage((stage) =>
        stage.step<string>((step) =>
          step.do((ctx) => ok(log, `create-user:${ctx.get<string>('tenant')}`, 'user-1')),
        ),
      )
      .build();

    const result = await saga.runAsync();

    expect(result.isSuccess).toBe(true);
    expect(result.outcome).toBe(SagaOutcome.Succeeded);
    // stage 2 read stage 1's published result; no compensation ran.
    expect(log).toEqual(['create-tenant', 'create-user:tenant-1']);
  });

  it('concurrent steps run in parallel within a stage', async () => {
    let started = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });

    async function waiter(): Promise<IBenzeneResultOf<string>> {
      started += 1;
      if (started === 2) {
        release();
      }
      await barrier;
      return BenzeneResult.ok('done');
    }

    const saga = new SagaBuilder()
      .stage((stage) => stage.step<string>((step) => step.do(() => waiter())).step<string>((step) => step.do(() => waiter())))
      .build();

    // If the two steps ran sequentially, the first would await a barrier only the second can release,
    // and this would deadlock and time the test out. Completing proves they ran concurrently.
    const result = await saga.runAsync();
    expect(result.isSuccess).toBe(true);
  });

  it('a step failing within a stage compensates succeeded siblings and rolls back', async () => {
    const log: string[] = [];

    const saga = new SagaBuilder()
      .stage((stage) =>
        stage
          .step<string>((step) => step.do(() => ok(log, 'create-a', 'a-1')).compensate((_, r) => undo(log, `undo-a:${r}`)))
          .step<string>((step) => step.do(() => fail(log, 'create-b'))),
      )
      .build();

    const result = await saga.runAsync();

    expect(result.outcome).toBe(SagaOutcome.RolledBack);
    expect(result.failedStageIndex).toBe(0);
    expect(log).toContain('undo-a:a-1'); // the succeeded sibling was compensated
  });

  it('a later stage failing compensates completed stages in reverse order', async () => {
    const log: string[] = [];

    const saga = new SagaBuilder()
      .stage((stage) => stage.step<string>((step) => step.do(() => ok(log, 's1', '1')).compensate(() => undo(log, 'undo-s1'))))
      .stage((stage) => stage.step<string>((step) => step.do(() => ok(log, 's2', '2')).compensate(() => undo(log, 'undo-s2'))))
      .stage((stage) => stage.step<string>((step) => step.do(() => fail(log, 's3'))))
      .build();

    const result = await saga.runAsync();

    expect(result.outcome).toBe(SagaOutcome.RolledBack);
    expect(result.failedStageIndex).toBe(2);
    // LIFO: s3 fails, then s2 undone, then s1 undone.
    expect(log).toEqual(['s1', 's2', 's3', 'undo-s2', 'undo-s1']);
  });

  it('a compensation itself failing returns PartiallyRolledBack', async () => {
    const saga = new SagaBuilder()
      .stage((stage) =>
        stage.step<string>((step) => step.do(() => Promise.resolve(BenzeneResult.ok('1'))).compensate(() => Promise.resolve(BenzeneResult.serviceUnavailable()))),
      ) // undo fails
      .stage((stage) => stage.step<string>((step) => step.do(() => Promise.resolve(BenzeneResult.serviceUnavailable<string>())))) // triggers rollback
      .build();

    const result = await saga.runAsync();

    expect(result.outcome).toBe(SagaOutcome.PartiallyRolledBack);
    expect(result.compensationFailures).toHaveLength(1);
    expect(result.compensationFailures[0]!.state).toBe(SagaStepState.CompensationFailed);
  });

  it('a throwing forward is treated as failure and rolls back prior stages', async () => {
    const log: string[] = [];

    const saga = new SagaBuilder()
      .stage((stage) => stage.step<string>((step) => step.do(() => ok(log, 's1', '1')).compensate(() => undo(log, 'undo-s1'))))
      .stage((stage) =>
        stage.step<string>((step) =>
          step.do((): Promise<IBenzeneResultOf<string>> => {
            throw new Error('boom');
          }),
        ),
      )
      .build();

    const result = await saga.runAsync();

    expect(result.outcome).toBe(SagaOutcome.RolledBack);
    expect(result.failedStageIndex).toBe(1);
    expect(result.failureException).toBeInstanceOf(Error);
    expect((result.failureException as Error).message).toBe('boom');
    expect(log).toContain('undo-s1');
  });

  it('a succeeded step with no compensation rolls back cleanly', async () => {
    // A read-only/no-effect step that succeeds has no compensation; a later failure should still report
    // a clean RolledBack (nothing to undo for that step).
    const saga = new SagaBuilder()
      .stage((stage) => stage.step<string>((step) => step.do(() => Promise.resolve(BenzeneResult.ok('read')))))
      .stage((stage) => stage.step<string>((step) => step.do(() => Promise.resolve(BenzeneResult.serviceUnavailable<string>()))))
      .build();

    const result = await saga.runAsync();

    expect(result.outcome).toBe(SagaOutcome.RolledBack);
    expect(result.compensationFailures).toHaveLength(0);
  });

  it('building with no stages throws', () => {
    expect(() => new SagaBuilder().build()).toThrow();
  });

  it('building a step with no forward throws', () => {
    expect(() => new SagaBuilder().stage((stage) => stage.step<string>(() => {})).build()).toThrow();
  });
});

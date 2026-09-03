import { describe, expect, it } from 'vitest';
import { IBenzeneResult, IBenzeneResultOf } from '@benzenejs/abstractions';
import { BenzeneResult } from '@benzenejs/results';
import { SagaBuilder, SagaOutcome, SagaStepState } from '@benzenejs/saga';

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

  it('two steps in the same stage failing concurrently surfaces both in failures', async () => {
    // #209: when two steps in the same stage fail concurrently, both must be surfaced - not just the
    // one `failure`/`failureException` happen to carry.
    const saga = new SagaBuilder()
      .stage((stage) =>
        stage
          .step<string>((step) => step.do(() => Promise.resolve(BenzeneResult.serviceUnavailable<string>())))
          .step<string>((step) => step.do(() => Promise.resolve(BenzeneResult.notFound<string>()))),
      )
      .build();

    const result = await saga.runAsync();

    expect(result.outcome).toBe(SagaOutcome.RolledBack);
    expect(result.failures).toHaveLength(2);
    for (const step of result.failures) {
      expect(step.state).toBe(SagaStepState.Failed);
    }

    // Both distinct failures are represented - a real regression here would show as duplicates
    // (a single failure double-counted) or a missing status.
    const statuses = result.failures.map((step) => step.result!.status);
    expect(statuses).toContain(BenzeneResult.serviceUnavailable<string>().status);
    expect(statuses).toContain(BenzeneResult.notFound<string>().status);

    // The existing single-failure members stay populated too - first item, for compatibility with
    // code written against the pre-#209 shape.
    expect(result.failure).toBe(result.failures[0].result);
    expect(result.failureException).toBe(result.failures[0].exception);
  });

  it('two steps failing concurrently, one by exception and one by result, surfaces both in failures', async () => {
    // #209: the same concurrent-failure surfacing, but one step fails via a thrown error and the other
    // via an ordinary failure result - `failures` must carry both regardless of which shape each
    // step's failure took.
    const saga = new SagaBuilder()
      .stage((stage) =>
        stage
          .step<string>((step) => step.do(() => Promise.resolve(BenzeneResult.serviceUnavailable<string>())))
          .step<string>((step) =>
            step.do((): Promise<IBenzeneResultOf<string>> => {
              throw new Error('boom');
            }),
          ),
      )
      .build();

    const result = await saga.runAsync();

    expect(result.outcome).toBe(SagaOutcome.RolledBack);
    expect(result.failures).toHaveLength(2);
    for (const step of result.failures) {
      expect(step.state).toBe(SagaStepState.Failed);
    }
    expect(result.failures.some((step) => step.exception instanceof Error)).toBe(true);
    expect(
      result.failures.some((step) => step.exception === undefined && step.result?.isSuccessful === false),
    ).toBe(true);

    // failure/failureException remain a backward-compatible view over the first entry.
    expect(result.failure).toBe(result.failures[0].result);
    expect(result.failureException).toBe(result.failures[0].exception);
  });

  it('a single failing step yields exactly one matching failures entry', async () => {
    // A single-step-failure run must still populate `failures` with exactly that one step, mirroring
    // `failure` - not just the multi-failure case.
    const saga = new SagaBuilder()
      .stage((stage) =>
        stage.step<string>((step) => step.do(() => Promise.resolve(BenzeneResult.serviceUnavailable<string>()))),
      )
      .build();

    const result = await saga.runAsync();

    expect(result.failures).toHaveLength(1);
    expect(result.failure).toBe(result.failures[0].result);
  });

  it('building with no stages throws', () => {
    expect(() => new SagaBuilder().build()).toThrow();
  });

  it('building a step with no forward throws', () => {
    expect(() => new SagaBuilder().stage((stage) => stage.step<string>(() => {})).build()).toThrow();
  });
});

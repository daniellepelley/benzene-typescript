import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { BenzeneResult } from '@benzene/results';
import { SagaContext, SagaStep, SagaStepState } from '@benzene/saga';

/** Port of test/Benzene.Core.Test/Saga/SagaStepTest.cs. */
describe('SagaStep', () => {
  it('reused across attempts does not leak an earlier attempt exception', async () => {
    // A saga retries by re-running the same step instances. If attempt 1 THREW and attempt 2 fails by
    // RETURNING a failed result, the step must not still report attempt 1's exception - that made
    // SagaResult.failureException claim the final attempt threw when it did not.
    let calls = 0;
    const step = new SagaStep<string>((): Promise<IBenzeneResultOf<string>> => {
      calls++;
      if (calls === 1) {
        throw new Error('attempt-1-threw');
      }

      return Promise.resolve(BenzeneResult.serviceUnavailable<string>());
    });

    await step.executeAsync(new SagaContext());
    expect(step.exception).toBeDefined();

    await step.executeAsync(new SagaContext());

    expect(step.state).toBe(SagaStepState.Failed);
    expect(step.exception).toBeUndefined();
  });
});

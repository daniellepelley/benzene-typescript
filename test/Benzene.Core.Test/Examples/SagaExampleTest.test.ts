/**
 * Drives `@benzene-example/saga`'s `buildSignupSaga` directly (the example is a plain program over
 * `@benzene/saga`, no host/transport) to prove the saga cross-cutting concern end-to-end: a multi-stage,
 * partly-parallel transaction either completes in full or rolls back in full, leaving no orphaned records.
 * Ports the four cases of the .NET `SignupSagaTest`.
 */
import { describe, expect, it } from 'vitest';
import { SagaOutcome } from '@benzene/saga';
import { buildSignupSaga, SignupApi, Store } from '@benzene-example/saga';

describe('@benzene-example/saga', () => {
  it('every stage succeeds: completes and persists all four records', async () => {
    const store = new Store();
    const api = new SignupApi(store);

    const result = await buildSignupSaga(api, 'Acme Ltd').runAsync();

    expect(result.outcome).toBe(SagaOutcome.Succeeded);
    expect(result.isSuccess).toBe(true);
    expect(result.failedStageIndex).toBeUndefined();
    expect(store.snapshot()).toHaveLength(4);
  });

  it('final stage fails: rolls back every earlier effect', async () => {
    const store = new Store();
    const api = new SignupApi(store);
    api.failAt = 'rbac-role';

    const result = await buildSignupSaga(api, 'Acme Ltd').runAsync();

    expect(result.outcome).toBe(SagaOutcome.RolledBack);
    expect(result.isSuccess).toBe(false);
    expect(result.failedStageIndex).toBe(2);
    expect(store.snapshot()).toHaveLength(0);
  });

  it('middle stage fails: rolls back the parallel first stage too', async () => {
    const store = new Store();
    const api = new SignupApi(store);
    api.failAt = 'user';

    const result = await buildSignupSaga(api, 'Acme Ltd').runAsync();

    expect(result.outcome).toBe(SagaOutcome.RolledBack);
    expect(result.failedStageIndex).toBe(1);
    // Stage 1's two parallel steps (tenant, okta-company) must BOTH be compensated even though the
    // failure happened one stage later — the case a naive "only unwind the current stage" gets wrong.
    expect(store.snapshot()).toHaveLength(0);
  });

  it('a first-stage parallel step fails: rolls back any sibling that already succeeded', async () => {
    const store = new Store();
    const api = new SignupApi(store);
    api.failAt = 'okta-company';

    const result = await buildSignupSaga(api, 'Acme Ltd').runAsync();

    expect(result.outcome).toBe(SagaOutcome.RolledBack);
    expect(result.failedStageIndex).toBe(0);
    // The sibling parallel step (tenant) may have already succeeded when okta-company fails — it must be
    // compensated too, not left orphaned.
    expect(store.snapshot()).toHaveLength(0);
  });
});

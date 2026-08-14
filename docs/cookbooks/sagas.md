# Sagas (distributed transactions that roll back cleanly)

Run a multi-step operation that spans several services, and if any step fails, undo every step that
already succeeded — in reverse — so the system ends up back where it started.

> **Boundary:** `@benzenejs/saga` is an in-process orchestrator with no durable crash-resume. It records
> what happened (via an `ISagaStateStore`) but cannot replay in-memory steps after the process dies.
> For a workflow that must survive a mid-flight restart, resume automatically, or wait on a human for
> hours, reach for a real durable orchestrator (AWS Step Functions, Azure Durable Functions, Temporal).
> See [What it does *not* do](#what-it-does-not-do-by-design).

## Problem Statement

Some operations span several services and must be all-or-nothing: a signup that creates a tenant, then
a user, then an RBAC role, across three systems. There's no database transaction that covers all three
— if the third step fails, you're left with an orphaned tenant and user. A **saga** solves this: run
the steps, and if any one fails, run each completed step's *compensation* in reverse to undo everything,
leaving the system back at its starting state so the whole thing can be retried.

`@benzenejs/saga` is an in-code saga orchestrator. There's no workflow engine to stand up, no decorators,
no DSL, no database — you describe the steps with a fluent builder and call `runAsync()`.

## Is this hard to use?

No. If you can write an `async` function, you can write a saga. The whole API is three nested builders
(`SagaBuilder → stage → step`) and each step is two plain functions: the thing to do, and the thing that
undoes it. The orchestrator handles ordering, concurrency, rollback order, and failure reporting. The
one part that needs real thought is writing correct **compensations** — that's inherent to the pattern,
not the library, and this guide calls out how to get it right.

## Prerequisites

- [Node.js 22+](https://nodejs.org/).
- Familiarity with [Message Results](../message-result.md) — a saga step returns the same
  `IBenzeneResultOf<T>` every Benzene handler returns.

## Installation

```bash
npm install @benzenejs/saga @benzenejs/results @benzenejs/abstractions
```

`@benzenejs/saga` has no host and no dependency-injection requirement — a saga is plain objects and
functions. If your forward actions call another service through Benzene's outbound sender, also install
`@benzenejs/clients` (see [Calling real services](#calling-real-services)).

## The mental model

```
Saga  ── ordered ──▶  Stage  ── concurrent ──▶  Step (do + undo)
```

- A **Step** is one unit of work plus its compensation: a forward action (`do`) and, optionally, the
  action that undoes it (`compensate`).
- A **Stage** is a group of steps that run **concurrently** and succeed or fail together.
- A **Saga** is an ordered list of stages that run **one after another**. A later stage can use an
  earlier stage's results.

If any step fails, the saga compensates every effect created so far — the failed stage's
concurrently-succeeded steps first, then each earlier stage newest-first (last-in, first-out) — and
reports a rolled-back result.

## The simplest possible saga

One stage, one step, with its compensation:

```ts
import { SagaBuilder, SagaResult } from '@benzenejs/saga';
import { createOrderAsync, cancelOrderAsync, Order } from './orders.js';

const saga = new SagaBuilder()
  .stage((stage) =>
    stage.step<Order>((step) =>
      step
        .do(() => createOrderAsync()) //            returns Promise<IBenzeneResultOf<Order>>
        .compensate((_ctx, order) => cancelOrderAsync(order.id)),
    ),
  )
  .build();

const result: SagaResult = await saga.runAsync();

if (result.isSuccess) {
  // every step succeeded
}
```

> **The front door is `new SagaBuilder()`.** The `Saga` class exists (it's what `build()` returns) but
> its constructor takes a pre-assembled array of stages — you never build one by hand. Everything goes
> through the builder.

A step's `do` returns `Promise<IBenzeneResultOf<T>>` — success is the result's `isSuccessful`. That's the
same result type `IBenzeneMessageSender.sendAsync(...)` and every Benzene handler already returns, so a
step usually *is* just a service call (see [Calling real services](#calling-real-services)).

## A realistic saga: parallel work + passing data forward

The signup flow — create a tenant and an Okta company **in parallel**, then a user (needs the tenant id),
then a role (needs the user id):

```ts
import { SagaBuilder } from '@benzenejs/saga';
import { api, TenantCreated, OktaCompanyCreated, UserCreated, RoleCreated } from './signup-api.js';

const companyName = 'Acme';

const saga = new SagaBuilder()
  // Stage 1: two steps run concurrently.
  .stage((stage) =>
    stage
      .step<TenantCreated>((step) =>
        step
          .do(() => api.createTenantAsync(companyName))
          .key('tenant') //                             publish under 'tenant' so a later stage can read it
          .compensate((_ctx, tenant) => api.deleteTenantAsync(tenant.tenantId)),
      )
      .step<OktaCompanyCreated>((step) =>
        step
          .do(() => api.createOktaCompanyAsync(companyName)) // no .key() — nothing downstream reads it
          .compensate((_ctx, company) => api.deleteOktaCompanyAsync(company.companyId)),
      ),
  )
  // Stage 2: runs after stage 1; reads the tenant id stage 1 produced.
  .stage((stage) =>
    stage.step<UserCreated>((step) =>
      step
        .do((ctx) => api.createUserAsync(ctx.get<TenantCreated>('tenant').tenantId))
        .key('user')
        .compensate((_ctx, user) => api.deleteUserAsync(user.userId)),
    ),
  )
  // Stage 3: reads the user id from stage 2.
  .stage((stage) =>
    stage.step<RoleCreated>((step) =>
      step
        .do((ctx) => api.createRoleAsync(ctx.get<UserCreated>('user').userId))
        .compensate((_ctx, role) => api.deleteRoleAsync(role.roleId)),
    ),
  )
  .build();

const result = await saga.runAsync();
```

If, say, the role step in stage 3 fails, the orchestrator undoes the user (stage 2), then the Okta
company and the tenant (stage 1) — in reverse — and returns `RolledBack`. No orphaned records.

## Passing data between stages: `SagaContext`

Each succeeded step publishes its result into a shared bag *after its stage completes*; a later stage
reads it by key:

```ts
.do((ctx) => api.createUserAsync(ctx.get<TenantCreated>('tenant').tenantId))
```

- `step.key('tenant')` — publish this step's result under `'tenant'`. A step with **no** key does not
  publish anything (nothing downstream can read it).
- `ctx.get<T>('tenant')` — the value published under `'tenant'`, cast to `T`. Throws if the key was
  never published.
- `ctx.tryGet<T>('tenant')` returns `T | undefined`; `ctx.has('tenant')` returns a boolean — for
  optional reads.

> **Divergence from .NET — keys are explicit strings, not types.** In the C# original, `ctx.Get<T>()`
> keys a value by its reified type (`typeof(T).FullName`), with an optional string override. TypeScript
> erases generics at runtime, so there's no type to key by — `ctx.get<T>('key')` is a compile-time cast
> over a string-keyed map. In the port you **must** call `.key('...')` on the producing step and
> `ctx.get<T>('...')` on the reader with the same string. This is a documented, intentional bend
> (see `src/Benzene.Saga/SagaContext.ts`), and it neatly replaces the .NET `.Key("...")` disambiguation:
> two steps in one stage simply publish under two different keys.

Steps within a stage run concurrently but only ever *read* earlier stages' values; writes happen at each
stage boundary, single-threaded — so there's no locking to worry about.

## Reading the result

`SagaResult` tells you exactly what happened:

| Member | Meaning |
|---|---|
| `isSuccess` / `outcome === SagaOutcome.Succeeded` | Every stage completed. |
| `outcome === SagaOutcome.RolledBack` | A step failed and **every** compensation succeeded — system is back to its starting state, safe to retry. |
| `outcome === SagaOutcome.PartiallyRolledBack` | A step failed **and at least one compensation also failed** — some effects may still exist. **Needs attention** (see `compensationFailures`). |
| `failedStageIndex` | Zero-based index of the stage that failed (`undefined` on success). |
| `failure` | The failing step's `IBenzeneResult` (why it failed). |
| `failureException` | The error the forward action threw, if it threw rather than returning a failed result. |
| `compensationFailures` | The steps whose compensation itself failed — the orphaned effects to reconcile manually. |

```ts
import { SagaOutcome } from '@benzenejs/saga';

const result = await saga.runAsync();
switch (result.outcome) {
  case SagaOutcome.Succeeded: //           done
    break;
  case SagaOutcome.RolledBack: //          clean failure — retry maybe
    break;
  case SagaOutcome.PartiallyRolledBack: // alert: manual cleanup
    break;
}
```

## Calling real services

A step's forward action is any `async` function returning `Promise<IBenzeneResultOf<T>>`. The two common
sources both already return exactly that, so there's no glue:

```ts
// A Benzene outbound message send (to another service over any transport) — see ../clients.md:
.do(() => messageSender.sendAsync<CreateTenant, TenantCreated>('tenant:create', new CreateTenant(name)))

// An HTTP/SDK call you wrap to return an IBenzeneResultOf<T>:
.do(() => httpClient.createTenantAsync(name))
```

`messageSender` is an [`IBenzeneMessageSender`](../clients.md) you resolve from the container in your
handler and close over when you build the saga. A forward action that **throws** is caught and treated
as a failed step (the error shows up as `result.failureException`), so you don't have to wrap calls in
try/catch to be safe.

## Writing good compensations

This is the part that deserves care — the library runs your compensation, but *correctness* is on you:

- **Key the undo by an id from the forward result.** The compensation's second argument is the forward
  step's own payload, so you always have the id of the thing to remove:
  `.compensate((_ctx, tenant) => api.deleteTenantAsync(tenant.tenantId))`.
- **Make it idempotent.** A compensation may run against an effect that's already gone (e.g. after a
  retry). "Delete tenant X" should succeed, or no-op, if X no longer exists — not throw.
- **A step with no side effect needs no `compensate`.** A read-only or pure step is simply "nothing to
  undo"; omit compensation and rollback skips it.
- **Compensation runs only for steps that succeeded.** A step that failed created no effect, so it's
  never compensated; the orchestrator only unwinds what actually happened.

## Automatic retry

A clean `RolledBack` means the system is back at its starting state — safe to try again. Instead of
looping yourself, pass a `SagaRetryPolicy` on the run options and the orchestrator re-runs the whole
saga with exponential backoff:

```ts
import { SagaRetryPolicy, SagaRunOptions } from '@benzenejs/saga';

const options = new SagaRunOptions();
options.retryPolicy = new SagaRetryPolicy(3, 1000); // 3 attempts, 1000ms initial delay, doubling

const result = await saga.runAsync(options);
```

`SagaRetryPolicy(maxAttempts, initialDelayMs, backoffFactor, delay)` maps the .NET `TimeSpan` delays to
millisecond numbers; `maxAttempts` is the *total* number of attempts (`1` = no retry, the default). The
final `delay` argument is a `(ms) => Promise<void>` you can override in tests to skip the real wait.

Retry is deliberately limited to `RolledBack`. A `Succeeded` saga needs no retry, and a
`PartiallyRolledBack` one may have left effects that a re-run would double-apply — so it's returned for
you to handle, never retried.

## Recording progress and outcome: `ISagaStateStore`

Pass an `ISagaStateStore` on the run options to record when a saga starts, each stage it completes, and
how it finishes — so a `RolledBack` or (especially) a `PartiallyRolledBack` outcome is **durably
visible** to an operator even if the process later restarts:

```ts
import { InMemorySagaStateStore, SagaRunOptions } from '@benzenejs/saga';

const store = new InMemorySagaStateStore(); // built-in; a durable adapter for production (below)

const options = new SagaRunOptions();
options.name = 'signup';
options.stateStore = store;

const result = await saga.runAsync(options);

for (const e of store.events) {
  console.log(`${e.sagaId} attempt ${e.attempt}: kind=${e.kind} stage=${e.stageIndex} ${e.result?.outcome}`);
}
```

`InMemorySagaStateStore` is the built-in, testable default — it accumulates `SagaStateEvent`s you can
read back with `.events` or `.eventsFor(sagaId)`. **This is the only store the port ships.** A durable
store is a three-method implementation of `ISagaStateStore` — persist each call to a row/document:

```ts
import { ISagaStateStore, SagaRunInfo, SagaResult, SagaOutcome } from '@benzenejs/saga';
import { ITable } from './table.js';

export class TableSagaStateStore implements ISagaStateStore {
  constructor(private readonly table: ITable) {}

  recordStartedAsync(run: SagaRunInfo): Promise<void> {
    return this.table.upsertAsync(run.sagaId, {
      name: run.name,
      attempt: run.attempt,
      stageCount: run.stageCount,
      status: 'started',
    });
  }

  recordStageCompletedAsync(sagaId: string, attempt: number, stageIndex: number): Promise<void> {
    return this.table.appendAsync(sagaId, { attempt, stageCompleted: stageIndex });
  }

  recordFinishedAsync(sagaId: string, attempt: number, result: SagaResult): Promise<void> {
    return this.table.upsertAsync(sagaId, { attempt, status: SagaOutcome[result.outcome] });
  }
}
```

Each method also takes an optional trailing `AbortSignal` (the port of C#'s `CancellationToken`) if your
storage client supports cancellation.

> **The store records progress; it does not *resume* a saga.** The steps are in-memory functions
> (closures), which can't be serialized and rehydrated after a crash — durable resume of arbitrary steps
> isn't something a closure-based engine can offer. What you get is durable observability and operational
> recovery: what ran, how far it got, and how it ended. If the host dies mid-saga, you re-run the
> operation; your idempotent forwards/compensations make that safe.

## What it does *not* do (by design)

- **No durable resume.** See the note above — the store records what happened; it doesn't replay
  in-memory steps after a crash. Re-run the operation instead (idempotency makes that safe).
- **No two-phase commit, no distributed locks.** That's the whole point of the saga pattern — it trades
  atomic isolation for compensations, which is what lets it span services that share no transaction.
- **No crash-durable long-running orchestration.** If you need a workflow that survives a process restart
  mid-flight, resumes automatically, or waits on a human for hours/days, that's a different problem than
  what `@benzenejs/saga` solves — reach for a real durable orchestrator: AWS Step Functions, Azure Durable
  Functions, Temporal, or similar.

## Testing

A saga is plain objects and functions, so tests need no host or mocking framework — hand back fakes that
return `BenzeneResult.ok(...)` or a failure, and assert on `SagaResult`:

```ts
import { describe, expect, it } from 'vitest';
import { BenzeneResult } from '@benzenejs/results';
import { SagaBuilder, SagaOutcome } from '@benzenejs/saga';

describe('signup saga', () => {
  it('rolls back the created tenant when a later step fails', async () => {
    const log: string[] = [];

    const saga = new SagaBuilder()
      .stage((stage) =>
        stage.step<string>((step) =>
          step
            .do(() => {
              log.push('create');
              return Promise.resolve(BenzeneResult.ok('id-1'));
            })
            .compensate((_ctx, id) => {
              log.push(`undo:${id}`);
              return Promise.resolve(BenzeneResult.ok());
            }),
        ),
      )
      .stage((stage) =>
        stage.step<string>((step) =>
          step.do(() => Promise.resolve(BenzeneResult.serviceUnavailable<string>())), // forces failure
        ),
      )
      .build();

    const result = await saga.runAsync();

    expect(result.outcome).toBe(SagaOutcome.RolledBack);
    expect(log).toEqual(['create', 'undo:id-1']); // stage-1 effect was undone
  });
});
```

The engine's own suite (`test/Benzene.Core.Test/Saga/`) covers the happy path, concurrent steps within a
stage, mid-stage failure + rollback, cross-stage LIFO rollback, compensation-failure →
`PartiallyRolledBack`, a forward-throws case, retry, and the state store — worth a read as executable
documentation. To test retry deterministically, construct `SagaRetryPolicy` with a no-op delay
(`new SagaRetryPolicy(3, 0, 2, () => Promise.resolve())`) so the test doesn't wait out the backoff.

## Troubleshooting

- **`ctx.get(...)` throws `No saga context value for '<key>'`** — either the producing step never called
  `.key('<key>')` (a step publishes nothing unless it declares a key), or you're reading a value in the
  same stage that produces it (values publish only *after* a stage completes). Add the `.key(...)`, or
  move the read to a later stage.
- **`A saga requires at least one stage` / `A saga stage requires at least one step`** — every saga needs
  a stage and every stage needs a step; `.build()` enforces it up front.
- **`A saga step requires a forward action - call do(...)`** — a step was configured without `.do(...)`;
  every step needs a forward action.
- **Got `PartiallyRolledBack`** — a compensation failed; the system may hold orphaned effects. Inspect
  `result.compensationFailures` (each is a step whose `state` is `SagaStepState.CompensationFailed`),
  reconcile them, and make those compensations idempotent so a re-run finishes the cleanup. This outcome
  is never auto-retried.

## Variations

### Retry a flaky saga automatically, but only when it's clean

Combine a retry policy with the state store so every attempt is recorded and only clean rollbacks are
re-run:

```ts
const options = new SagaRunOptions();
options.name = 'signup';
options.stateStore = store;
options.retryPolicy = new SagaRetryPolicy(3, 1000);

const result = await saga.runAsync(options);
```

Each attempt shares one saga id (set `options.sagaId` to control it, or let the store generate one), so
`store.eventsFor(id)` shows the full attempt history.

### A step that reads but creates nothing

Give it a `do` and no `compensate`. It can still `.key(...)` its result for a later stage to read; on
rollback the orchestrator simply skips it (nothing to undo).

## Further Reading

- [Handling SQS Message Failures](handling-sqs-failures.md) — retry and dead-letter handling for a
  single message, the queue-level counterpart to saga-level rollback.
- [Mocking External Dependencies](mocking-dependencies.md) — faking the services a saga step calls.
- [Message Results](../message-result.md) — the `BenzeneResult` factory and `IBenzeneResultOf<T>` a step
  returns.
- [Clients](../clients.md) — `IBenzeneMessageSender.sendAsync`, the natural forward action for a step.
- [Resilience](../resilience.md) — in-process retry middleware for a single handler (distinct from
  whole-saga retry).
- [Middleware](../middleware.md) and [Message Handlers](../message-handlers.md) — the surrounding
  pipeline a saga is usually kicked off from.
- [Testing Benzene](../testing-benzene.md) — the full testing guide.

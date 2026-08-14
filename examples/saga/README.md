# `@benzene-example/saga`

A user-signup **distributed transaction with rollback** over [`@benzenejs/saga`](../../src/Benzene.Saga):
the flow spans several services and either **completes in full or rolls back in full**, leaving no
orphaned records — so it can be safely retried. Ported from the .NET `Benzene.Example.Saga`.

The saga (see [`src/signupSaga.ts`](src/signupSaga.ts)):

- **Stage 1** (parallel): create the tenant **and** create the company in Okta.
- **Stage 2**: create the user, using the tenant ID from stage 1.
- **Stage 3**: create the RBAC role, using the user ID from stage 2.

Each step carries the compensation that undoes it. If any step fails, the orchestrator compensates every
completed effect in reverse order.

In a real Benzene system each step's `do(...)` is a call to another service via an `IBenzeneMessageSender`
— `sendMessageAsync(sender, 'tenant:create', req)` already returns `Promise<IBenzeneResultOf<T>>`, exactly
what a step's `do(...)` wants. Here the calls are backed by an in-memory store
([`src/signupApi.ts`](src/signupApi.ts) / [`src/store.ts`](src/store.ts)) so the example runs on its own
and you can watch rollback take effect.

## Port note — context keys

.NET keys a step's published result by its result TYPE (`ctx.Get<TenantCreated>()`). TypeScript erases
generics, so a later stage reads an earlier result by an **explicit string key** — declared with `.key(...)`
and read with `ctx.get<T>(key)`. That is the only added ceremony versus the C#.

## Run it

```bash
npm start -w @benzene-example/saga
```

It runs the saga twice — happy path, then forcing stage 3 to fail — printing the play-by-play and, for the
failing run, the reverse-order compensation and the empty store at the end.

## Verify it

`test/Benzene.Core.Test/Examples/SagaExampleTest.test.ts` drives `buildSignupSaga` directly (no
host/transport — the example is a plain program over `@benzenejs/saga`) across all four cases: full success,
a final-stage failure, a middle-stage failure (which must still roll back the *parallel* first stage), and
a first-stage parallel-step failure (which must roll back the sibling that already succeeded). Every
rollback leaves the store empty.

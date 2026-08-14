# Per-request transactions with a scoped Unit of Work

Benzene runs every request/message in its own **DI scope** (`serviceResolverFactory.createScope()`),
so a service registered with the `scoped` lifetime lives and dies with a single request — isolated
from every other in-flight request. That is exactly the boundary a database transaction wants: begin
per request, commit if the handler succeeds, roll back if it fails.

This cookbook shows the **Unit of Work** pattern over that scope, using two pieces the port provides:

- `IServiceResolver.disposeAsync()` — asynchronous scope teardown (the port of .NET's
  `AsyncServiceScope`/`IAsyncDisposable`), so a scoped resource can `await` real work (commit/rollback,
  return a pooled connection) at scope end.
- `UnitOfWorkMiddleware` — commits the scoped `IUnitOfWork` when the pipeline succeeds, rolls it back
  when it throws.

## 1. Implement `IUnitOfWork`

Register it **scoped** so each request gets its own. Implement `disposeAsync()` as a safety-net
rollback for a unit left unsettled (an early return, a bug, a path with no middleware). Note this
safety net fires **only when the scope is torn down with `disposeAsync()`** — a synchronous
`dispose()` cannot await it, skips it, and warns (see below), so a unit left unsettled would leak.
Every built-in transport tears its per-request scope down with `disposeAsync()`, so in practice the
net is always armed:

```ts
import { IUnitOfWork } from '@benzenejs/abstractions';

export class DbUnitOfWork implements IUnitOfWork {
  static readonly inject = [Database]; // constructor injection

  private readonly transaction: Transaction;
  private settled = false;

  constructor(database: Database) {
    this.transaction = database.begin();
  }

  // your repositories write through this.transaction within the same scope
  get tx(): Transaction {
    return this.transaction;
  }

  async commit(): Promise<void> {
    this.settled = true;
    await this.transaction.commit();
  }

  async rollback(): Promise<void> {
    this.settled = true;
    await this.transaction.rollback();
  }

  async disposeAsync(): Promise<void> {
    if (!this.settled) {
      await this.transaction.rollback(); // safety net at scope end
    }
  }
}
```

## 2. Register it and add the middleware

```ts
import { unitOfWorkMiddleware } from '@benzenejs/core-middleware';
import { IUnitOfWork } from '@benzenejs/abstractions';

container.addSingletonInstance(Database, database);
container.addScoped(IUnitOfWork, DbUnitOfWork);

app.use(unitOfWorkMiddleware()); // near the front, so it wraps the handlers
```

The middleware resolves the scoped `IUnitOfWork`, runs the rest of the pipeline, then **commits on
success / rolls back on throw**. Pass `unitOfWorkMiddleware({ shouldCommit: (ctx) => ... })` to roll
back on a *failure result* (not just an exception).

Because the commit/rollback is awaited **inside** the pipeline (the `UnitOfWorkMiddleware`), the normal
path is fully transport-independent — it does **not** depend on how the host tears the scope down. The
async scope disposal is the *extra* safety net (and the right hook for pooled connections / other
`AsyncDisposable` resources), and it is the one part that **is** teardown-dependent: the
`disposeAsync()`-based rollback of an unsettled unit only runs under `disposeAsync()` teardown. Under a
synchronous `dispose()`, an async-only disposable is skipped and the resolver emits a one-time
`console.warn` rather than silently dropping it. This is why every built-in transport tears its
per-request scope down with `disposeAsync()`.

## Why scoped, not singleton

A `singleton` transaction would be shared across every concurrent request — the classic data-corruption
bug. `scoped` is what makes each request's unit of work private. (Avoid the inverse footgun too: a
singleton that depends on a scoped `IUnitOfWork` would capture the first request's transaction forever —
a "captive dependency".)

## See also

- `test/Benzene.Core.Test/Middleware/UnitOfWorkMiddlewareTest.test.ts` — commit, rollback-on-throw,
  `shouldCommit`, per-scope isolation, and the async-dispose safety net, all through the real pipeline.
- `test/Benzene.Core.Test/Dependencies/AsyncDisposalTest.test.ts` — the `disposeAsync()` scope behavior.
- [Mocking dependencies](./mocking-dependencies.md) — overriding registrations (e.g. faking the store) in tests.

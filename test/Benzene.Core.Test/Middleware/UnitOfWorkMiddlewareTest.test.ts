import { describe, expect, it } from 'vitest';
import {
  IBenzeneServiceContainer,
  IServiceResolver,
  IServiceResolverFactory,
  IUnitOfWork,
} from '@benzenejs/abstractions';
import { MiddlewareFunc } from '@benzenejs/abstractions-middleware';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import {
  MiddlewarePipelineBuilder,
  UnitOfWorkOptions,
  unitOfWorkMiddleware,
} from '@benzenejs/core-middleware';

interface Ctx {
  value: string;
}

// --- A fake transactional store: writes become visible in `committed` only after commit() -------

class FakeDatabase {
  readonly committed: string[] = [];
  readonly events: string[] = []; // begin / commit / rollback log, to prove atomicity

  begin(): FakeTransaction {
    this.events.push('begin');
    return new FakeTransaction(this);
  }
}

class FakeTransaction {
  private readonly writes: string[] = [];
  private done = false;

  constructor(private readonly db: FakeDatabase) {}

  write(value: string): void {
    this.writes.push(value);
  }

  async commit(): Promise<void> {
    if (this.done) return;
    this.done = true;
    this.db.committed.push(...this.writes);
    this.db.events.push('commit');
  }

  async rollback(): Promise<void> {
    if (this.done) return;
    this.done = true;
    this.db.events.push('rollback');
  }
}

// A scoped Unit of Work: begins a transaction on construction (so each scope gets its own),
// commit/rollback delegate, and disposeAsync is the safety-net rollback for a unit left unsettled.
class DbUnitOfWork implements IUnitOfWork {
  static readonly inject = [FakeDatabase];

  private readonly transaction: FakeTransaction;
  private settled = false;

  constructor(database: FakeDatabase) {
    this.transaction = database.begin();
  }

  write(value: string): void {
    this.transaction.write(value);
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
      await this.transaction.rollback();
    }
  }
}

function newContainer(db: FakeDatabase): IBenzeneServiceContainer {
  const container = new DefaultBenzeneServiceContainer();
  container.addServiceResolver();
  container.addSingletonInstance(FakeDatabase, db);
  container.addScoped(IUnitOfWork, DbUnitOfWork); // one unit of work per scope
  return container;
}

const writeHandler: MiddlewareFunc<Ctx> = (context, next, resolver) => {
  (resolver.getService(IUnitOfWork) as unknown as DbUnitOfWork).write(context.value);
  return next();
};

const throwingWriteHandler: MiddlewareFunc<Ctx> = (context, next, resolver) => {
  (resolver.getService(IUnitOfWork) as unknown as DbUnitOfWork).write(context.value);
  throw new Error('handler failed');
};

function build(
  container: IBenzeneServiceContainer,
  handler: MiddlewareFunc<Ctx>,
  options?: UnitOfWorkOptions<Ctx>,
) {
  const builder = new MiddlewarePipelineBuilder<Ctx>(container);
  builder.use(unitOfWorkMiddleware<Ctx>(options));
  builder.useFn(handler);
  return builder.build();
}

async function handleInScope(
  factory: IServiceResolverFactory,
  pipeline: { handleAsync(context: Ctx, resolver: IServiceResolver): Promise<void> },
  value: string,
): Promise<void> {
  const scope = factory.createScope();
  try {
    await pipeline.handleAsync({ value }, scope);
  } finally {
    await scope.disposeAsync!();
  }
}

describe('UnitOfWorkMiddleware', () => {
  it('commits the unit of work when the handler succeeds', async () => {
    const db = new FakeDatabase();
    const container = newContainer(db);
    const pipeline = build(container, writeHandler);

    await handleInScope(container.createServiceResolverFactory(), pipeline, 'order-1');

    expect(db.committed).toEqual(['order-1']);
    expect(db.events).toEqual(['begin', 'commit']);
  });

  it('rolls back and rethrows when the handler throws', async () => {
    const db = new FakeDatabase();
    const container = newContainer(db);
    const pipeline = build(container, throwingWriteHandler);

    await expect(
      handleInScope(container.createServiceResolverFactory(), pipeline, 'order-1'),
    ).rejects.toThrow('handler failed');

    expect(db.committed).toEqual([]); // nothing persisted
    expect(db.events).toEqual(['begin', 'rollback']);
  });

  it('rolls back when shouldCommit returns false (a failure result, not an exception)', async () => {
    const db = new FakeDatabase();
    const container = newContainer(db);
    const pipeline = build(container, writeHandler, { shouldCommit: () => false });

    await handleInScope(container.createServiceResolverFactory(), pipeline, 'order-1');

    expect(db.committed).toEqual([]);
    expect(db.events).toEqual(['begin', 'rollback']);
  });

  it('isolates the unit of work per scope — each request commits its own transaction', async () => {
    const db = new FakeDatabase();
    const container = newContainer(db);
    const pipeline = build(container, writeHandler);
    const factory = container.createServiceResolverFactory();

    await handleInScope(factory, pipeline, 'a');
    await handleInScope(factory, pipeline, 'b');

    expect(db.committed).toEqual(['a', 'b']);
    expect(db.events).toEqual(['begin', 'commit', 'begin', 'commit']); // two independent transactions
  });

  it('disposeAsync is a safety net: a unit left unsettled rolls back at scope end', async () => {
    const db = new FakeDatabase();
    const container = newContainer(db);
    const scope = container.createServiceResolverFactory().createScope();

    // Resolve + use the unit of work but never commit/rollback (e.g. an early return, no middleware).
    (scope.getService(IUnitOfWork) as unknown as DbUnitOfWork).write('x');
    await scope.disposeAsync!();

    expect(db.committed).toEqual([]);
    expect(db.events).toEqual(['begin', 'rollback']);
  });
});

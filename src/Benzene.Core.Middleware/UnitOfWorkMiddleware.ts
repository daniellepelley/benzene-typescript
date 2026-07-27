import { IServiceResolver, IUnitOfWork } from '@benzene/abstractions';
import { IMiddleware, MiddlewareFactoryFunc, NextFunc } from '@benzene/abstractions-middleware';

/** Options for {@link UnitOfWorkMiddleware}. */
export interface UnitOfWorkOptions<TContext> {
  /**
   * Decides whether to commit after the handler ran without throwing. Return `false` to roll back —
   * e.g. when the pipeline produced a failure result rather than an exception. Defaults to committing
   * whenever the handler did not throw.
   */
  shouldCommit?(context: TContext): boolean;
}

/**
 * Wraps the rest of the pipeline in a scoped {@link IUnitOfWork}: commit when the handler succeeds,
 * roll back when it throws (or when `shouldCommit` returns false). Register the unit of work as a
 * **scoped** service and add this middleware near the front of the pipeline; because the middleware
 * is created per-scope with that scope's resolver, each request commits/rolls back its own unit,
 * isolated from every other in-flight request. The commit/rollback is awaited inside the pipeline, so
 * this works on every transport regardless of whether the host tears the scope down with `dispose()`
 * or `disposeAsync()`.
 */
export class UnitOfWorkMiddleware<TContext> implements IMiddleware<TContext> {
  readonly name = 'UnitOfWork';

  constructor(
    private readonly serviceResolver: IServiceResolver,
    private readonly options?: UnitOfWorkOptions<TContext>,
  ) {}

  async handleAsync(context: TContext, next: NextFunc): Promise<void> {
    const unitOfWork = this.serviceResolver.getService(IUnitOfWork);

    try {
      await next();
    } catch (error) {
      await unitOfWork.rollback();
      throw error;
    }

    if (this.options?.shouldCommit && !this.options.shouldCommit(context)) {
      await unitOfWork.rollback();
      return;
    }

    await unitOfWork.commit();
  }
}

/**
 * Factory for {@link UnitOfWorkMiddleware}, ready to pass to `pipeline.use(...)`:
 *
 * ```ts
 * container.addScoped(IUnitOfWork, MyUnitOfWork);
 * app.use(unitOfWorkMiddleware());
 * ```
 */
export function unitOfWorkMiddleware<TContext>(
  options?: UnitOfWorkOptions<TContext>,
): MiddlewareFactoryFunc<TContext> {
  return (serviceResolver: IServiceResolver) =>
    new UnitOfWorkMiddleware<TContext>(serviceResolver, options);
}

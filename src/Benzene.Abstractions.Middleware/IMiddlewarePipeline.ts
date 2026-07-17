import { IServiceResolver } from '@benzene/abstractions';

/**
 * An executable middleware pipeline that processes context objects through a chain
 * of middleware components. Pipelines are immutable once built, reusable and safe
 * for concurrent execution.
 * Port of Benzene.Abstractions.Middleware.IMiddlewarePipeline&lt;TContext&gt;.
 */
export interface IMiddlewarePipeline<TContext> {
  /** Executes the middleware pipeline with the provided context. */
  handleAsync(context: TContext, serviceResolver: IServiceResolver): Promise<void>;
}

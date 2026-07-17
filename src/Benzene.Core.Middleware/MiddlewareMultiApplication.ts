import { IServiceResolverFactory } from '@benzene/abstractions';
import {
  IMiddlewareApplication,
  IMiddlewareApplicationWithResult,
  IMiddlewarePipeline,
} from '@benzene/abstractions-middleware';

/**
 * Maps an event to multiple contexts and runs the pipeline concurrently for each,
 * each in its own scope. Port of
 * Benzene.Core.Middleware.MiddlewareMultiApplication&lt;TEvent, TContext, TResult&gt;.
 */
export class MiddlewareMultiApplicationWithResult<TEvent, TContext, TResult>
  implements IMiddlewareApplicationWithResult<TEvent, TResult[]>
{
  constructor(
    private readonly pipeline: IMiddlewarePipeline<TContext>,
    private readonly mapper: (event: TEvent) => TContext[],
    private readonly resultMapper: (context: TContext) => TResult,
  ) {}

  handleAsync(event: TEvent, serviceResolverFactory: IServiceResolverFactory): Promise<TResult[]> {
    const tasks = this.mapper(event).map(async (context) => {
      const scope = serviceResolverFactory.createScope();
      try {
        await this.pipeline.handleAsync(context, scope);
        return this.resultMapper(context);
      } finally {
        scope.dispose();
      }
    });

    return Promise.all(tasks);
  }
}

/** Port of Benzene.Core.Middleware.MiddlewareMultiApplication&lt;TEvent, TContext&gt;. */
export class MiddlewareMultiApplication<TEvent, TContext> implements IMiddlewareApplication<TEvent> {
  constructor(
    private readonly pipeline: IMiddlewarePipeline<TContext>,
    private readonly mapper: (event: TEvent) => TContext[],
  ) {}

  async handleAsync(event: TEvent, serviceResolverFactory: IServiceResolverFactory): Promise<void> {
    const tasks = this.mapper(event).map(async (context) => {
      const scope = serviceResolverFactory.createScope();
      try {
        await this.pipeline.handleAsync(context, scope);
      } finally {
        scope.dispose();
      }
    });

    await Promise.all(tasks);
  }
}

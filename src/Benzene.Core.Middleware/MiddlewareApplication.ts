import { IServiceResolverFactory } from '@benzene/abstractions';
import {
  IMiddlewareApplication,
  IMiddlewareApplicationWithResult,
  IMiddlewarePipeline,
} from '@benzene/abstractions-middleware';

/**
 * Maps an event to a context, runs the pipeline in a fresh scope and maps the result.
 * Port of Benzene.Core.Middleware.MiddlewareApplication&lt;TEvent, TContext, TResult&gt;
 * (C# `using var serviceResolver` maps to try/finally dispose).
 */
export class MiddlewareApplicationWithResult<TEvent, TContext, TResult>
  implements IMiddlewareApplicationWithResult<TEvent, TResult>
{
  constructor(
    private readonly pipeline: IMiddlewarePipeline<TContext>,
    private readonly mapper: (event: TEvent) => TContext,
    private readonly resultMapper: (context: TContext) => TResult,
  ) {}

  async handleAsync(event: TEvent, serviceResolverFactory: IServiceResolverFactory): Promise<TResult> {
    const context = this.mapper(event);
    const serviceResolver = serviceResolverFactory.createScope();
    try {
      await this.pipeline.handleAsync(context, serviceResolver);
      return this.resultMapper(context);
    } finally {
      serviceResolver.dispose();
    }
  }
}

/** Port of Benzene.Core.Middleware.MiddlewareApplication&lt;TEvent, TContext&gt;. */
export class MiddlewareApplication<TEvent, TContext> implements IMiddlewareApplication<TEvent> {
  constructor(
    private readonly pipeline: IMiddlewarePipeline<TContext>,
    private readonly mapper: (event: TEvent) => TContext,
  ) {}

  async handleAsync(event: TEvent, serviceResolverFactory: IServiceResolverFactory): Promise<void> {
    const context = this.mapper(event);
    const serviceResolver = serviceResolverFactory.createScope();
    try {
      await this.pipeline.handleAsync(context, serviceResolver);
    } finally {
      serviceResolver.dispose();
    }
  }
}

import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { RetryMiddleware, RetryOptions } from './RetryMiddleware';

/**
 * Adds retry-with-backoff around the rest of the pipeline.
 * Port of Benzene.Resilience.Extensions.UseRetry.
 *
 * The C# `UseRetry` is a fluent extension method on `IMiddlewarePipelineBuilder`. TypeScript
 * cannot add a method to the builder base class from a separate package, so this is a free
 * function taking the builder as its first argument and returning it for chaining — the same
 * shape the non-fluent extension-method convention already uses across the port.
 */
export function useRetry<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  options: RetryOptions<TContext> = {},
): IMiddlewarePipelineBuilder<TContext> {
  return app.use(() => new RetryMiddleware<TContext>(options));
}

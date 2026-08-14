/** Port of Benzene.Resilience.Polly.Extensions. */
import { IMiddlewarePipelineBuilder } from '@benzenejs/abstractions-middleware';
import { IDefaultPolicyContext, IPolicy } from 'cockatiel';
import { CockatielResilienceMiddleware } from './CockatielResilienceMiddleware';

/**
 * Runs the rest of the pipeline through the given cockatiel {@link IPolicy}. Strategies fire on errors
 * thrown by downstream middleware/handlers; if `isFailure` is supplied, an unsuccessful result (per the
 * predicate) is additionally surfaced as a handled outcome so it can be retried, trip a breaker, or be
 * fallen back from — configure the policy to handle {@link BenzeneFailureResultException} for that to
 * take effect.
 *
 * The C# `UseResiliencePipeline` is a fluent extension method on `IMiddlewarePipelineBuilder`;
 * TypeScript cannot add a method to the builder base class from a separate package, so this is a free
 * function taking the builder first and returning it for chaining — the same shape the port uses for
 * every non-fluent extension method (and for `@benzenejs/resilience`'s `useRetry`).
 *
 * PORT DIVERGENCE: C# has four overloads — `(pipeline)`, `(pipeline, isFailure)`, and two that build the
 * pipeline inline from an `Action<ResiliencePipelineBuilder>`. cockatiel has no mutable pipeline builder;
 * policies are composed *functionally* (`wrap(retry(...), circuitBreaker(...))`), so the "build inline"
 * overloads have no counterpart — a caller "builds inline" simply by constructing the {@link IPolicy}
 * argument. The two remaining overloads collapse into this one function with an optional `isFailure`.
 *
 * @param app The pipeline builder.
 * @param policy The cockatiel policy to run the rest of the pipeline through.
 * @param isFailure Optional predicate reporting whether the context holds an unsuccessful result after
 * `next` ran.
 * @returns The same builder, for chaining.
 */
export function useResiliencePipeline<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  policy: IPolicy<IDefaultPolicyContext, unknown>,
  isFailure?: (context: TContext) => boolean,
): IMiddlewarePipelineBuilder<TContext> {
  return app.use(() => new CockatielResilienceMiddleware<TContext>(policy, isFailure));
}

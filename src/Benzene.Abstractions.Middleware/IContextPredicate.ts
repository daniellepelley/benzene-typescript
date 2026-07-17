import { IServiceResolver } from '@benzene/abstractions';

/**
 * Conditional logic determining whether middleware should execute based on context
 * state — used for routing, conditional execution, feature flags and pipeline branching.
 * Port of Benzene.Abstractions.Middleware.IContextPredicate&lt;TContext&gt;.
 */
export interface IContextPredicate<TContext> {
  /** Checks whether the predicate condition is satisfied for the given context. */
  check(context: TContext, serviceResolver: IServiceResolver): boolean;
}

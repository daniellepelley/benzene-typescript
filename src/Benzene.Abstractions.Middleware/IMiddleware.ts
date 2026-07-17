import { IServiceResolver } from '@benzene/abstractions';

/** Continues the pipeline. Port of C# `Func<Task> next`. */
export type NextFunc = () => Promise<void>;

/**
 * An inline middleware handler function.
 * Port of C# `Func<TContext, Func<Task>, Task>`; the optional trailing resolver
 * argument also covers the C# `Func<IServiceResolver, TContext, Func<Task>, Task>`
 * overloads (argument order is context-first throughout the TypeScript port).
 */
export type MiddlewareFunc<TContext> = (
  context: TContext,
  next: NextFunc,
  serviceResolver: IServiceResolver,
) => Promise<void> | void;

/**
 * A middleware component in the Benzene pipeline, processing requests in a chain
 * of responsibility pattern. Middleware execute in registration order and may
 * perform work before/after calling `next`, or short-circuit by not calling it.
 * Port of Benzene.Abstractions.Middleware.IMiddleware&lt;TContext&gt;.
 */
export interface IMiddleware<TContext> {
  /** Unique name of this middleware, used for logging, debugging and diagnostics. */
  readonly name: string;

  /** Handles the middleware processing. Port of C# `HandleAsync(TContext, Func<Task>)`. */
  handleAsync(context: TContext, next: NextFunc): Promise<void>;
}

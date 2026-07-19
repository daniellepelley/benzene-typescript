import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { StreamContext } from './StreamContext';

/**
 * Port of Benzene.Core.Middleware.StreamExtensions.
 *
 * Pipeline steps for consuming a {@link StreamContext}. These are ordinary middleware, so they
 * compose with every other Benzene solution (correlation, metrics, exception handling) on the same
 * builder.
 *
 * The C# `UseStream` methods are fluent extension methods on
 * `IMiddlewarePipelineBuilder<StreamContext<TItem>>`. TypeScript has no extension methods, so — per
 * the port's non-fluent-extension convention — they become a free function taking the builder as its
 * first argument and returning it for chaining.
 *
 * C# has two `UseStream` overloads distinguished by delegate type: one taking the whole
 * `StreamContext<TItem>`, one taking `(IAsyncEnumerable<TItem>, CancellationToken)`. They map to a
 * single `useStream` with two TypeScript call signatures, discriminated at runtime by the callback's
 * declared parameter count (`>= 2` ⇒ the items+signal overload) — the same way the C# compiler
 * selects the overload by the lambda's arity. Platform mappings: `IAsyncEnumerable<TItem>` →
 * `AsyncIterable<TItem>`, `CancellationToken` → `AbortSignal | undefined`, `Task` → `Promise<void>`.
 *
 * Note: because TypeScript contextually types an un-annotated arrow from a function's *first*
 * overload only, the whole-context overload (listed first) infers its `context` parameter, but a
 * bare `(items, signal) =>` callback for the second overload must annotate its parameters.
 */

/**
 * Adds a terminal stream-processing step that receives the whole {@link StreamContext}.
 *
 * @typeParam TItem The type of item flowing through the stream.
 * @param app The stream pipeline builder.
 * @param process The delegate that consumes the stream context.
 * @returns The pipeline builder, for method chaining.
 */
export function useStream<TItem>(
  app: IMiddlewarePipelineBuilder<StreamContext<TItem>>,
  process: (context: StreamContext<TItem>) => Promise<void>,
): IMiddlewarePipelineBuilder<StreamContext<TItem>>;

/**
 * Adds a terminal stream-processing step that receives the item stream and abort signal directly —
 * the common case when you don't need the rest of the context.
 *
 * @typeParam TItem The type of item flowing through the stream.
 * @param app The stream pipeline builder.
 * @param process The delegate that consumes the items.
 * @returns The pipeline builder, for method chaining.
 */
export function useStream<TItem>(
  app: IMiddlewarePipelineBuilder<StreamContext<TItem>>,
  process: (items: AsyncIterable<TItem>, signal: AbortSignal | undefined) => Promise<void>,
): IMiddlewarePipelineBuilder<StreamContext<TItem>>;

export function useStream<TItem>(
  app: IMiddlewarePipelineBuilder<StreamContext<TItem>>,
  process:
    | ((context: StreamContext<TItem>) => Promise<void>)
    | ((items: AsyncIterable<TItem>, signal: AbortSignal | undefined) => Promise<void>),
): IMiddlewarePipelineBuilder<StreamContext<TItem>> {
  const contextProcess: (context: StreamContext<TItem>) => Promise<void> =
    process.length >= 2
      ? (context) =>
          (process as (items: AsyncIterable<TItem>, signal: AbortSignal | undefined) => Promise<void>)(
            context.items,
            context.signal,
          )
      : (process as (context: StreamContext<TItem>) => Promise<void>);

  return app.useFn('Stream', async (context, next) => {
    await contextProcess(context);
    await next();
  });
}

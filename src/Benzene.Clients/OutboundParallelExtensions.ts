import { IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { createMiddlewarePipeline } from '@benzene/core-middleware';
import { OutboundContext } from './OutboundContext';
import { ParallelOutboundMiddleware } from './ParallelOutboundMiddleware';

/** One transport branch of a parallel send: a display name and its single-transport configuration. */
export interface OutboundBranch {
  readonly name: string;
  readonly configure: PipelineBuilderAction<OutboundContext>;
}

/**
 * Sends the message to every named branch concurrently rather than one after another. Use it in an
 * `addOutboundRouting` route to fan a single topic out to several transports at once. The send succeeds
 * only if every branch succeeds; otherwise the result is a single failure whose errors name each failed
 * transport (all-must-succeed). This is a terminal send step - it does not continue to any middleware
 * added after it.
 * Port of Benzene.Clients.OutboundParallelExtensions.UseParallel (a C# extension method -> a free
 * function; C#'s `params (string, Action)[]` becomes an explicit `branches` array).
 *
 * @param maxDegreeOfParallelism Caps how many branches send at once; `undefined` or <= 0 is unbounded.
 */
export function useParallel(
  app: IMiddlewarePipelineBuilder<OutboundContext>,
  branches: OutboundBranch[],
  maxDegreeOfParallelism?: number,
): IMiddlewarePipelineBuilder<OutboundContext> {
  if (branches.length === 0) {
    throw new Error('useParallel requires at least one branch.');
  }

  const built = branches.map((branch) => ({
    name: branch.name,
    pipeline: createMiddlewarePipeline(app, branch.configure),
  }));

  return app.use((resolver) => new ParallelOutboundMiddleware(built, resolver, maxDegreeOfParallelism));
}

import { IBenzeneResult, IServiceResolver, VoidResult } from '@benzene/abstractions';
import { IMiddleware, IMiddlewarePipeline, NextFunc } from '@benzene/abstractions-middleware';
import { BoundedFanOut } from '@benzene/core-middleware';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import { OutboundContext } from './OutboundContext';

/** One transport's send: its display name and the (single-transport) pipeline that runs it. */
export interface OutboundBranchPipeline {
  readonly name: string;
  readonly pipeline: IMiddlewarePipeline<OutboundContext>;
}

interface BranchOutcome {
  name: string;
  result: IBenzeneResult | undefined;
  error: unknown;
}

/**
 * Sends one outbound message to several transports concurrently, instead of the default awaited chain
 * that sends to each in turn. Each branch runs on its own cloned {@link OutboundContext} - the outbound
 * middleware write onto `headers` and each branch sets its own `response`, so sharing one context would
 * race both. All branches are awaited together ({@link BoundedFanOut}, so concurrency is capped when a
 * limit is given), then the results are aggregated all-must-succeed: success only if every branch
 * succeeded, otherwise a single failure whose errors name each failed transport.
 * Port of Benzene.Clients.ParallelOutboundMiddleware (not exported from the package index).
 */
export class ParallelOutboundMiddleware implements IMiddleware<OutboundContext> {
  readonly name = 'ParallelSend';

  constructor(
    private readonly branches: readonly OutboundBranchPipeline[],
    private readonly serviceResolver: IServiceResolver,
    private readonly maxDegreeOfParallelism: number | undefined,
  ) {}

  async handleAsync(context: OutboundContext, _next: NextFunc): Promise<void> {
    const outcomes = await BoundedFanOut.whenAllAsync(
      this.branches,
      async (branch): Promise<BranchOutcome> => {
        // A fresh context per branch (its ctor copies headers), so concurrent branches don't race the
        // shared header object or the single response slot.
        const branchContext = new OutboundContext(context.topic, context.request, context.headers);
        try {
          await branch.pipeline.handleAsync(branchContext, this.serviceResolver);
          return {
            name: branch.name,
            result: isBenzeneResult(branchContext.response) ? branchContext.response : undefined,
            error: undefined,
          };
        } catch (error) {
          // Catch per branch rather than let the first failure abort the fan-out - every branch still
          // runs, and the aggregate can then name all of the ones that failed.
          return { name: branch.name, result: undefined, error };
        }
      },
      this.maxDegreeOfParallelism,
    );

    const failures = outcomes.filter(
      (outcome) => outcome.error !== undefined || outcome.result === undefined || !outcome.result.isSuccessful,
    );

    if (failures.length === 0) {
      context.response = BenzeneResult.ok<VoidResult>();
      return;
    }

    context.response = BenzeneResult.setErrors<VoidResult>(
      BenzeneResultStatus.unexpectedError,
      ...failures.map(formatError),
    );
  }
}

function formatError(outcome: BranchOutcome): string {
  if (outcome.error !== undefined) {
    const error = outcome.error;
    const errorName = error instanceof Error ? error.constructor.name : typeof error;
    const message = error instanceof Error ? error.message : String(error);
    return `${outcome.name}: ${errorName}: ${message}`;
  }
  return `${outcome.name}: ${outcome.result?.status ?? 'no response'}`;
}

function isBenzeneResult(value: unknown): value is IBenzeneResult {
  return typeof value === 'object' && value !== null && 'isSuccessful' in value && 'status' in value;
}

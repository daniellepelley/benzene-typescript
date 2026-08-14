/** Port of Benzene.Resilience.Polly.PollyResilienceMiddleware. */
import { IMiddleware, NextFunc } from '@benzenejs/abstractions-middleware';
import { IDefaultPolicyContext, IPolicy } from 'cockatiel';
import { BenzeneFailureResultException } from './BenzeneFailureResultException';

/**
 * Middleware that runs the rest of the pipeline (`next`) through a cockatiel {@link IPolicy} — so any
 * strategy the policy is built with (retry, circuit breaker, timeout, bulkhead, fallback, or any
 * composition via `wrap`) applies to whatever `next` wraps: a handler dispatch on an inbound pipeline,
 * or a port/service call on an outbound one. The policy is supplied ready-built, so the only per-message
 * cost is `policy.execute`.
 *
 * PORTING NOTES: the Polly v8 `ResiliencePipeline` maps to a cockatiel {@link IPolicy} (the composed
 * policy), and `ResiliencePipeline.ExecuteAsync` to `IPolicy.execute`. The policy's `AltReturn` is
 * widened to `unknown` so a fallback-wrapped policy is still accepted; the middleware ignores the
 * returned value (the outcome lives on the context).
 */
export class CockatielResilienceMiddleware<TContext> implements IMiddleware<TContext> {
  /**
   * @param policy The cockatiel policy to execute `next` through.
   * @param isFailure Optional predicate reporting whether the pipeline produced an unsuccessful result
   * after `next` ran (e.g. `ctx => ctx.messageResult?.isSuccessful === false`). When supplied and it
   * returns `true`, the middleware throws {@link BenzeneFailureResultException} so the policy can treat
   * the failure result as a handled outcome; the error never escapes (see that type's docs). When
   * omitted (the default), only thrown errors drive the policy's strategies.
   */
  constructor(
    private readonly policy: IPolicy<IDefaultPolicyContext, unknown>,
    private readonly isFailure?: (context: TContext) => boolean,
  ) {}

  readonly name = 'CockatielResilienceMiddleware';

  async handleAsync(context: TContext, next: NextFunc): Promise<void> {
    try {
      await this.policy.execute(async () => {
        await next();

        if (this.isFailure !== undefined && this.isFailure(context)) {
          // Surface an unsuccessful result to cockatiel as a handled outcome. Swallowed below once the
          // policy has finished, so the failure result on the context is what callers see — identical
          // to running without this middleware.
          throw new BenzeneFailureResultException();
        }
      });
    } catch (error) {
      // Retries (etc.) exhausted and the last attempt still produced a failure result. The result is
      // already on the context; swallow only the sentinel. A real error propagates unchanged.
      if (!(error instanceof BenzeneFailureResultException)) {
        throw error;
      }
    }
  }
}

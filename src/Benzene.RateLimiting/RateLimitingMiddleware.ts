import { IServiceResolver } from '@benzene/abstractions';
import {
  IMessageHandlerDefinitionLookUp,
  IMessageHandlerResultSetter,
  IMessageTopicGetter,
} from '@benzene/abstractions-message-handlers';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { MessageHandlerResult } from '@benzene/core-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { MetadataName, RateLimitLease, RateLimiter } from './RateLimiters';

/**
 * Computes the current message's permit cost from its scope and context. Port of C#
 * `Func<IServiceResolver, TContext, int>`.
 */
export type PermitCost<TContext> = (resolver: IServiceResolver, context: TContext) => number;

/**
 * Best-effort, per-instance rate limiting over any {@link RateLimiter}. Each message attempts to
 * acquire its permit cost (1 by default; e.g. the payload's byte size for a bytes-per-second token
 * bucket) without queuing; a message the limiter rejects is short-circuited with a `TooManyRequests`
 * result (HTTP 429 via the standard status mapping). The acquired lease is held across `next()` so
 * concurrency-style limiters release correctly.
 * Port of Benzene.RateLimiting.RateLimitingMiddleware&lt;TContext&gt;.
 *
 * Deliberately simple protection for endpoints a service can't avoid exposing (health checks, spec) -
 * a brake on abuse and runaway serverless cost, not an exact science: the limit is per service
 * instance, so a fleet of N instances admits up to N x the configured rate. Authoritative rate
 * limiting belongs at the gateway in front of all instances.
 */
export class RateLimitingMiddleware<TContext> implements IMiddleware<TContext> {
  constructor(
    private readonly rateLimiter: RateLimiter,
    private readonly permitCost: PermitCost<TContext>,
    private readonly serviceResolver: IServiceResolver,
  ) {}

  get name(): string {
    return 'RateLimiting';
  }

  async handleAsync(context: TContext, next: NextFunc): Promise<void> {
    const cost = Math.max(0, this.permitCost(this.serviceResolver, context));

    let lease: RateLimitLease | undefined;
    try {
      try {
        lease = this.rateLimiter.attemptAcquire(cost);
      } catch (ex) {
        // The cost exceeds what the limiter could ever grant (e.g. a payload larger than the whole
        // token bucket) - that is a rejection, not an internal error. .NET throws
        // ArgumentOutOfRangeException here; the ported limiters throw RangeError.
        if (!(ex instanceof RangeError)) {
          throw ex;
        }
      }

      if (lease === undefined || !lease.isAcquired) {
        await this.setTooManyRequestsAsync(context, lease);
        return;
      }

      await next();
    } finally {
      // Held across next() so a concurrency-style limiter's permits are returned when the message
      // completes; a no-op for window/bucket limiters.
      lease?.dispose();
    }
  }

  private setTooManyRequestsAsync(context: TContext, lease: RateLimitLease | undefined): Promise<void> {
    let error = 'Rate limit exceeded';
    const retryAfter = lease?.tryGetMetadata(MetadataName.retryAfter);
    if (retryAfter?.found && retryAfter.value !== undefined) {
      error = `Rate limit exceeded; retry after ${Math.round(retryAfter.value / 1000)}s`;
    }

    // Attach the topic's handler definition so the response pipeline writes the ErrorPayload body (it
    // skips definition-less results) - same pattern as Benzene.JsonSchema.
    const topicGetter = this.serviceResolver.tryGetService(
      IMessageTopicGetter,
    ) as unknown as IMessageTopicGetter<TContext> | undefined;
    const topic = topicGetter?.getTopic(context);
    const definition = topic
      ? this.serviceResolver.tryGetService(IMessageHandlerDefinitionLookUp)?.findHandler(topic)
      : undefined;

    const resultSetter = this.serviceResolver.getService(
      IMessageHandlerResultSetter,
    ) as unknown as IMessageHandlerResultSetter<TContext>;

    return resultSetter.setResultAsync(
      context,
      new MessageHandlerResult(topic, definition, BenzeneResult.tooManyRequests(error)),
    );
  }
}

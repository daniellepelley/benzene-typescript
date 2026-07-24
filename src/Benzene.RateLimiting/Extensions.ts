import { IMessageBodyGetter } from '@benzene/abstractions-messages';
import { IServiceResolver } from '@benzene/abstractions';
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { PermitCost, RateLimitingMiddleware } from './RateLimitingMiddleware';
import { FixedWindowRateLimiter } from './RateLimiters/FixedWindowRateLimiter';
import { TokenBucketRateLimiter } from './RateLimiters/TokenBucketRateLimiter';
import { RateLimiter } from './RateLimiters/RateLimiter';

/**
 * Pipeline extensions for best-effort, per-instance rate limiting. Place the call BEFORE the
 * middleware it should protect (e.g. before `useHealthCheck`/`useSpec`/`useMessageHandlers`). The limit
 * is per service instance - authoritative limiting belongs at the gateway; see docs/rate-limiting.md.
 * Port of Benzene.RateLimiting.Extensions (C# extension methods -> free functions taking the builder
 * first, matching the port's other `use*` helpers). C#'s `TimeSpan` window/period arguments become
 * millisecond `number`s per the port's TimeSpan -> ms convention.
 */

/**
 * Rate-limits the pipeline with a caller-supplied (bring-your-own) {@link RateLimiter}, costing one
 * permit per message by default, or a caller-supplied per-message `permitCost`. The limiter instance
 * is shared for the pipeline's lifetime - the caller owns its disposal.
 */
export function useRateLimiting<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  rateLimiter: RateLimiter,
  permitCost: PermitCost<TContext> = () => 1,
): IMiddlewarePipelineBuilder<TContext> {
  return app.use((resolver) => new RateLimitingMiddleware<TContext>(rateLimiter, permitCost, resolver));
}

/**
 * Rate-limits to at most `permitLimit` messages per `windowMs` (a {@link FixedWindowRateLimiter}; no
 * queuing - excess messages get `TooManyRequests` immediately). The simple guard for utility endpoints
 * like health checks.
 */
export function useFixedWindowRateLimiting<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  permitLimit: number,
  windowMs: number,
): IMiddlewarePipelineBuilder<TContext> {
  return useRateLimiting(
    app,
    new FixedWindowRateLimiter({ permitLimit, windowMs, queueLimit: 0, autoReplenishment: true }),
  );
}

/**
 * Rate-limits messages through a {@link TokenBucketRateLimiter}: bursts up to `tokenLimit`, refilled
 * with `tokensPerPeriod` every `replenishmentPeriodMs`. One token per message; no queuing.
 */
export function useTokenBucketRateLimiting<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  tokenLimit: number,
  tokensPerPeriod: number,
  replenishmentPeriodMs: number,
): IMiddlewarePipelineBuilder<TContext> {
  return useRateLimiting(app, createTokenBucket(tokenLimit, tokensPerPeriod, replenishmentPeriodMs));
}

/**
 * Rate-limits by PAYLOAD SIZE: a token bucket where each message costs its request body's size in
 * UTF-8 bytes (a bodyless message costs 1), allowing up to `bytesPerPeriod` bytes every
 * `replenishmentPeriodMs` with bursts up to `maxBurstBytes`. A single payload larger than
 * `maxBurstBytes` is always rejected.
 */
export function usePayloadSizeRateLimiting<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  maxBurstBytes: number,
  bytesPerPeriod: number,
  replenishmentPeriodMs: number,
): IMiddlewarePipelineBuilder<TContext> {
  return useRateLimiting(
    app,
    createTokenBucket(maxBurstBytes, bytesPerPeriod, replenishmentPeriodMs),
    (resolver: IServiceResolver, context: TContext) => {
      const bodyGetter = resolver.tryGetService(IMessageBodyGetter) as unknown as
        | IMessageBodyGetter<TContext>
        | undefined;
      const body = bodyGetter?.getBody(context);
      return body === undefined || body === '' ? 1 : Buffer.byteLength(body, 'utf8');
    },
  );
}

function createTokenBucket(
  tokenLimit: number,
  tokensPerPeriod: number,
  replenishmentPeriodMs: number,
): TokenBucketRateLimiter {
  return new TokenBucketRateLimiter({
    tokenLimit,
    tokensPerPeriod,
    replenishmentPeriodMs,
    queueLimit: 0,
    autoReplenishment: true,
  });
}

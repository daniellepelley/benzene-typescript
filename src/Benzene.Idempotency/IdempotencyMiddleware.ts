import { IMessageResult } from '@benzene/abstractions-message-handlers';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { BenzeneResult } from '@benzene/results';
import { IIdempotencyKeyStrategy } from './IIdempotencyKeyStrategy';
import { IIdempotencyStore } from './IIdempotencyStore';
import { IdempotencyConflictException } from './IdempotencyConflictException';
import { IdempotencyOptions } from './IdempotencyOptions';
import { IdempotencyRecord } from './IdempotencyRecord';
import { IdempotencyStatus } from './IdempotencyStatus';
import { InProgressBehavior } from './InProgressBehavior';

/** The optional `IHasMessageResult` shape, duck-typed at runtime (C# `context is IHasMessageResult`). */
type MaybeHasMessageResult = { messageResult?: IMessageResult };

/**
 * Middleware that de-duplicates redelivered messages on an at-least-once transport. It derives an
 * idempotency key for each message, atomically claims it in an {@link IIdempotencyStore}, and only
 * invokes the rest of the pipeline (including the handler) the first time that key is seen. Duplicates
 * short-circuit without re-running the handler.
 * Port of Benzene.Idempotency.IdempotencyMiddleware&lt;TContext&gt;.
 *
 * Place it early in the pipeline - before the handler, but typically after logging/tracing so
 * duplicates are still observable. If the handler throws, or reports failure via `IHasMessageResult`,
 * the claim is released so the transport's redelivery reprocesses the message rather than the failure
 * being permanently suppressed. Only a successful first attempt is recorded as completed.
 */
export class IdempotencyMiddleware<TContext> implements IMiddleware<TContext> {
  readonly name = 'IdempotencyMiddleware';

  constructor(
    private readonly store: IIdempotencyStore,
    private readonly keyStrategy: IIdempotencyKeyStrategy<TContext>,
    private readonly options: IdempotencyOptions,
  ) {}

  async handleAsync(context: TContext, next: NextFunc): Promise<void> {
    const key = this.keyStrategy.getKey(context);
    if (key === undefined) {
      // No key derived -> this message opts out of de-duplication; process normally.
      await next();
      return;
    }

    const claim = await this.store.tryClaimAsync(key);
    if (!claim.claimed) {
      this.handleDuplicate(context, claim.existingRecord!);
      return;
    }

    try {
      await next();
    } catch (error) {
      // The handler threw. Release the claim so a redelivery can reprocess the message.
      await this.store.releaseAsync(key);
      throw error;
    }

    if (wasSuccessful(context)) {
      await this.store.completeAsync(key, true);
    } else {
      // The handler ran but reported failure. Release so the redelivery retries.
      await this.store.releaseAsync(key);
    }
  }

  private handleDuplicate(context: TContext, existing: IdempotencyRecord): void {
    if (
      existing.status === IdempotencyStatus.InProgress &&
      this.options.inProgressBehavior === InProgressBehavior.Throw
    ) {
      throw new IdempotencyConflictException(existing.key);
    }

    // A completed duplicate (or an in-progress one under Skip): short-circuit without re-running the
    // handler. For transports that report completion via a message result, mark it successful so the
    // duplicate is acknowledged and removed from the queue rather than redelivered again.
    const hasResult = asHasMessageResult(context);
    if (hasResult !== undefined) {
      hasResult.messageResult = BenzeneResult.ok();
    }
  }
}

function wasSuccessful<TContext>(context: TContext): boolean {
  // Prefer the pipeline's own result signal when the transport sets one; otherwise treat "the handler
  // did not throw" as success.
  const hasResult = asHasMessageResult(context);
  if (hasResult?.messageResult != null) {
    return hasResult.messageResult.isSuccessful;
  }

  return true;
}

function asHasMessageResult<TContext>(context: TContext): MaybeHasMessageResult | undefined {
  return typeof context === 'object' && context !== null && 'messageResult' in context
    ? (context as MaybeHasMessageResult)
    : undefined;
}

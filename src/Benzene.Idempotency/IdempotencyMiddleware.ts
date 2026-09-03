import { ILogger, NullLogger } from '@benzenejs/abstractions';
import { IMessageResult } from '@benzenejs/abstractions-message-handlers';
import { IMiddleware, NextFunc } from '@benzenejs/abstractions-middleware';
import { BenzeneResult } from '@benzenejs/results';
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

  private readonly logger: ILogger;

  /**
   * @param store The store claims are made against and settled through.
   * @param keyStrategy Derives the idempotency key for each message.
   * @param options De-duplication behaviour options.
   * @param logger The logger used to record a reclaimed-claim warning. Defaults to
   * {@link NullLogger.instance}.
   */
  constructor(
    private readonly store: IIdempotencyStore,
    private readonly keyStrategy: IIdempotencyKeyStrategy<TContext>,
    private readonly options: IdempotencyOptions,
    logger?: ILogger,
  ) {
    this.logger = logger ?? NullLogger.instance;
  }

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

    const claimToken = claim.claimToken!;

    try {
      await next();
    } catch (error) {
      // The handler threw. Release the claim so a redelivery can reprocess the message.
      await this.releaseAsync(key, claimToken);
      throw error;
    }

    if (wasSuccessful(context)) {
      const settled = await this.store.completeAsync(key, claimToken, true);
      if (!settled) {
        // The claim was reclaimed by another worker before this attempt finished (it lapsed and
        // someone else won it) - the new holder owns the outcome now, so this is expected under
        // contention, not an error.
        this.logger.logWarning(
          `Idempotency claim for key ${key} was reclaimed by another worker before this attempt ` +
            'could complete it; outcome recorded by the new holder.',
        );
      }
    } else {
      // The handler ran but reported failure. Release so the redelivery retries.
      await this.releaseAsync(key, claimToken);
    }
  }

  private async releaseAsync(key: string, claimToken: string): Promise<void> {
    // The throwing caller of this helper is inside a `catch { await this.releaseAsync(...); throw; }`
    // - the rethrow after this call is what propagates the ORIGINAL handler error (the failed-result
    // release has no error to protect, but the principle applies uniformly). If `store.releaseAsync`
    // itself throws (a real store failure, not a fenced `false`), that new error would otherwise
    // propagate from here and the caller's own rethrow would never run - silently replacing the
    // actual reason the message failed with an unrelated store error. Catch and log it here instead,
    // so this method never throws and the caller's own rethrow always executes (the C# settle-never-
    // masks rule).
    try {
      const released = await this.store.releaseAsync(key, claimToken);
      if (!released) {
        this.logger.logWarning(
          `Idempotency claim for key ${key} was reclaimed by another worker before this attempt ` +
            'could release it; outcome recorded by the new holder.',
        );
      }
    } catch (releaseError) {
      this.logger.logError(
        releaseError,
        `Releasing idempotency claim for key ${key} failed after a processing failure; the claim ` +
          'may remain held until it naturally expires, at which point a redelivery can reclaim it.',
      );
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
  // Prefer the pipeline's own result signal when the transport sets one. A result-bearing transport
  // (IHasMessageResult) that completed without ever setting messageResult has not proven success -
  // matching the "null == failure, redeliver" convention (the C# #260 rule) - so that case must NOT
  // fall through to true.
  const hasResult = asHasMessageResult(context);
  if (hasResult !== undefined) {
    return hasResult.messageResult?.isSuccessful === true;
  }

  // A transport with no result concept at all has no signal to be consistent with: no-throw still
  // means success here, unchanged.
  return true;
}

function asHasMessageResult<TContext>(context: TContext): MaybeHasMessageResult | undefined {
  return typeof context === 'object' && context !== null && 'messageResult' in context
    ? (context as MaybeHasMessageResult)
    : undefined;
}

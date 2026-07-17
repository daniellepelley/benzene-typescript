import { describe, expect, it } from 'vitest';
import { OperationCanceledException, RetryMiddleware } from '@benzene/resilience';

/** Port of Benzene.Test.Resilience.RetryMiddlewareTest. */
const noDelay = () => Promise.resolve();

describe('RetryMiddlewareTest', () => {
  it('HandleAsync_SucceedsAfterTransientFailures', async () => {
    let attempts = 0;
    const middleware = new RetryMiddleware<object>({ numberOfRetries: 3, delay: noDelay });

    await middleware.handleAsync({}, () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('transient');
      }
      return Promise.resolve();
    });

    expect(attempts).toBe(3);
  });

  it('HandleAsync_ExhaustsRetries_PropagatesException', async () => {
    let attempts = 0;
    const middleware = new RetryMiddleware<object>({ numberOfRetries: 2, delay: noDelay });

    await expect(
      middleware.handleAsync({}, () => {
        attempts++;
        throw new Error('always fails');
      }),
    ).rejects.toThrow('always fails');

    expect(attempts).toBe(3);
  });

  it('HandleAsync_OperationCanceledException_NotRetriedByDefault', async () => {
    let attempts = 0;
    const middleware = new RetryMiddleware<object>({ numberOfRetries: 3, delay: noDelay });

    await expect(
      middleware.handleAsync({}, () => {
        attempts++;
        throw new OperationCanceledException();
      }),
    ).rejects.toBeInstanceOf(OperationCanceledException);

    expect(attempts).toBe(1);
  });

  it('HandleAsync_CustomShouldRetry_NarrowsDefaultBehavior', async () => {
    let attempts = 0;
    const middleware = new RetryMiddleware<object>({
      numberOfRetries: 3,
      delay: noDelay,
      shouldRetry: (error) => error instanceof RangeError,
    });

    await expect(
      middleware.handleAsync({}, () => {
        attempts++;
        throw new Error('not retryable per custom predicate');
      }),
    ).rejects.toThrow('not retryable per custom predicate');

    expect(attempts).toBe(1);
  });

  it('HandleAsync_SucceedsFirstTry_NoRetry', async () => {
    let attempts = 0;
    const middleware = new RetryMiddleware<object>({ numberOfRetries: 3, delay: noDelay });

    await middleware.handleAsync({}, () => {
      attempts++;
      return Promise.resolve();
    });

    expect(attempts).toBe(1);
  });

  it('HandleAsync_ShouldRetryContext_RetriesOnUnsatisfactoryResult', async () => {
    let attempts = 0;
    const context = { done: false };
    const middleware = new RetryMiddleware<{ done: boolean }>({
      numberOfRetries: 5,
      delay: noDelay,
      shouldRetryContext: (c) => !c.done,
    });

    await middleware.handleAsync(context, () => {
      attempts++;
      if (attempts >= 3) {
        context.done = true;
      }
      return Promise.resolve();
    });

    // Retries while the context says "not done"; stops once done is set on the 3rd attempt.
    expect(attempts).toBe(3);
  });
});

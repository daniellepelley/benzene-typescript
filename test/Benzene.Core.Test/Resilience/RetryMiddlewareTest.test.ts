import { describe, expect, it } from 'vitest';
import { OperationCanceledException, RetryMiddleware } from '@benzenejs/resilience';

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

  // The .NET R16 #252/#256 rule, ported: "is this OUR cancellation?" is decided by the caller's own
  // signal, never by the error's type. A cancellation-shaped error thrown WITHOUT the caller's signal
  // being aborted is a foreign, transient failure (e.g. a per-request HTTP timeout) and IS retried.
  it('HandleAsync_ForeignCancellationShapedError_IsRetriedByDefault', async () => {
    let attempts = 0;
    const middleware = new RetryMiddleware<object>({ numberOfRetries: 3, delay: noDelay });

    await middleware.handleAsync({}, () => {
      attempts++;
      if (attempts < 3) {
        // The shape a per-request timeout throws — the caller's own signal is NOT aborted.
        throw new OperationCanceledException();
      }
      return Promise.resolve();
    });

    expect(attempts).toBe(3);
  });

  it('HandleAsync_OwnSignalAborted_StopsRetrying', async () => {
    let attempts = 0;
    const controller = new AbortController();
    const middleware = new RetryMiddleware<object>({
      numberOfRetries: 5,
      delay: noDelay,
      signal: controller.signal,
    });

    await expect(
      middleware.handleAsync({}, () => {
        attempts++;
        if (attempts === 2) {
          // The caller aborts while the second attempt is failing.
          controller.abort();
        }
        throw new Error('transient-looking');
      }),
    ).rejects.toThrow('transient-looking');

    // Attempt 1 fails and retries; attempt 2 fails with the signal now aborted — no third attempt.
    expect(attempts).toBe(2);
  });

  it('HandleAsync_OwnSignalAlreadyAborted_DoesNotRetryAnyErrorType', async () => {
    let attempts = 0;
    const controller = new AbortController();
    controller.abort();
    const middleware = new RetryMiddleware<object>({
      numberOfRetries: 3,
      delay: noDelay,
      signal: controller.signal,
    });

    await expect(
      middleware.handleAsync({}, () => {
        attempts++;
        throw new Error('would otherwise be retried');
      }),
    ).rejects.toThrow('would otherwise be retried');

    expect(attempts).toBe(1);
  });

  it('HandleAsync_SignalReadOffTheContext_WhenNoneConfigured', async () => {
    let attempts = 0;
    const controller = new AbortController();
    controller.abort();
    const middleware = new RetryMiddleware<{ signal: AbortSignal }>({ numberOfRetries: 3, delay: noDelay });

    await expect(
      middleware.handleAsync({ signal: controller.signal }, () => {
        attempts++;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(attempts).toBe(1);
  });

  it('HandleAsync_OwnSignalAborted_StopsContextPredicateRetries', async () => {
    let attempts = 0;
    const controller = new AbortController();
    const middleware = new RetryMiddleware<object>({
      numberOfRetries: 5,
      delay: noDelay,
      signal: controller.signal,
      shouldRetryContext: () => true,
    });

    await middleware.handleAsync({}, () => {
      attempts++;
      if (attempts === 2) {
        controller.abort();
      }
      return Promise.resolve();
    });

    expect(attempts).toBe(2);
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

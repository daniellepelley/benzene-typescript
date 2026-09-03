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

  // --- W3.13: maxDelayMs cap + jitter (ports of the .NET RetryMiddlewareTest cases). The cap and
  // jitter apply to the actual SLEEP only; the exponential growth curve stays uncapped (AWS's
  // documented "full jitter": sleep = random(0, min(cap, base * factor^attempt))). ------------------

  /** Runs an always-failing pipeline through `middleware`, recording every sleep handed to `delay`. */
  async function recordSleeps(options: {
    numberOfRetries: number;
    initialDelayMs: number;
    backoffFactor: number;
    maxDelayMs?: number;
    jitter?: (delayMs: number) => number;
  }): Promise<number[]> {
    const recorded: number[] = [];
    const middleware = new RetryMiddleware<object>({
      ...options,
      delay: (delayMs) => {
        recorded.push(delayMs);
        return Promise.resolve();
      },
    });

    await expect(
      middleware.handleAsync({}, () => {
        throw new Error('always fails');
      }),
    ).rejects.toThrow('always fails');

    return recorded;
  }

  it('HandleAsync_MaxDelay_CapsTheActualSleepButNotTheUnderlyingGrowth', async () => {
    const sleeps = await recordSleeps({
      numberOfRetries: 3,
      initialDelayMs: 10,
      backoffFactor: 3.0,
      maxDelayMs: 50,
    });

    // Uncapped growth would be 10ms, 30ms, 90ms - the third attempt is capped at 50ms.
    expect(sleeps).toEqual([10, 30, 50]);
  });

  it('HandleAsync_Jitter_AppliedToTheCappedDelayBeforeSleeping', async () => {
    const sleeps = await recordSleeps({
      numberOfRetries: 2,
      initialDelayMs: 10,
      backoffFactor: 2.0,
      maxDelayMs: 15,
      jitter: (delayMs) => delayMs + 1,
    });

    // Uncapped/unjittered growth would be 10ms, 20ms; capped at 15ms, then +1ms jitter.
    expect(sleeps).toEqual([11, 16]);
  });

  it('HandleAsync_FullJitterWithSeededRandom_PinsTheSleepSequence', async () => {
    // A deterministic "seeded" random source: cycles through fixed values, so the whole sleep
    // sequence is pinned exactly - sleep = random() * min(cap, base * factor^attempt).
    const values = [0.5, 0.25, 1.0];
    let call = 0;
    const random = (): number => values[call++ % values.length]!;

    const sleeps = await recordSleeps({
      numberOfRetries: 3,
      initialDelayMs: 10,
      backoffFactor: 2.0,
      maxDelayMs: 30,
      jitter: RetryMiddleware.fullJitter(random),
    });

    // Capped delays are 10, 20, 30 (growth 10, 20, 40); jittered by 0.5, 0.25, 1.0.
    expect(sleeps).toEqual([5, 5, 30]);
  });

  it('HandleAsync_NoJitterOrMaxDelaySpecified_BehavesExactlyAsBefore', async () => {
    const sleeps = await recordSleeps({
      numberOfRetries: 2,
      initialDelayMs: 10,
      backoffFactor: 2.0,
    });

    expect(sleeps).toEqual([10, 20]);
  });

  it('HandleAsync_NoMaxDelay_ClampsTheSleepToASetTimeoutSafeCeiling', async () => {
    // With no maxDelayMs the uncapped exponential sleep grows past setTimeout's 2^31-1 ms ceiling
    // (above it Node fires the timer after 1ms - a hot loop, not a long sleep). Every sleep handed
    // to `delay` must stay within that ceiling, and the tail attempts must actually reach the clamp,
    // proving it engaged rather than the growth just never getting large enough.
    const maxSafe = 2_147_483_647;
    const sleeps = await recordSleeps({
      numberOfRetries: 40,
      initialDelayMs: 1000,
      backoffFactor: 2.0,
    });

    expect(sleeps).toHaveLength(40);
    for (const sleep of sleeps) {
      expect(sleep).toBeLessThanOrEqual(maxSafe);
    }
    expect(sleeps).toContain(maxSafe);
  });

  it('fullJitter_ReturnsADurationBetweenZeroAndTheInputDelay', () => {
    const jitter = RetryMiddleware.fullJitter();

    for (let i = 0; i < 20; i++) {
      const result = jitter(100);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    }
  });
});

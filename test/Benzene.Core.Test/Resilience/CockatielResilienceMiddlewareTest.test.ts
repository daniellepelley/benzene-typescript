import { describe, expect, it } from 'vitest';
import {
  BrokenCircuitError,
  circuitBreaker,
  ConsecutiveBreaker,
  ConstantBackoff,
  fallback,
  handleAll,
  handleType,
  retry,
} from 'cockatiel';
import { BenzeneFailureResultException, CockatielResilienceMiddleware } from '@benzene/cockatiel';

/**
 * Ports Benzene.Test.Resilience.PollyResilienceMiddlewareTest to cockatiel. The Polly
 * `ResiliencePipelineBuilder().AddRetry(...)` becomes cockatiel `retry(policy, { maxAttempts, backoff })`
 * — `maxAttempts` is the retry count beyond the first attempt (matching Polly's `MaxRetryAttempts`),
 * `ConstantBackoff(0)` the zero delay, and `handleType(...)`/`handleAll` the `ShouldHandle` predicate.
 */

interface TestContext {
  failed: boolean;
}

/** Analogue of the C# `InvalidOperationException` used for the thrown-error retry cases. */
class TransientError extends Error {
  constructor(message = 'transient') {
    super(message);
    this.name = 'TransientError';
  }
}

describe('CockatielResilienceMiddleware', () => {
  it('runs next once on success', async () => {
    let attempts = 0;
    const middleware = new CockatielResilienceMiddleware<TestContext>(
      retry(handleAll, { maxAttempts: 3, backoff: new ConstantBackoff(0) }),
    );

    await middleware.handleAsync({ failed: false }, async () => {
      attempts++;
    });

    expect(attempts).toBe(1);
  });

  it('retries a thrown error until it succeeds', async () => {
    let attempts = 0;
    const middleware = new CockatielResilienceMiddleware<TestContext>(
      retry(handleType(TransientError), { maxAttempts: 3, backoff: new ConstantBackoff(0) }),
    );

    await middleware.handleAsync({ failed: false }, async () => {
      attempts++;
      if (attempts < 3) {
        throw new TransientError();
      }
    });

    expect(attempts).toBe(3);
  });

  it('propagates the real error after retries are exhausted', async () => {
    let attempts = 0;
    const middleware = new CockatielResilienceMiddleware<TestContext>(
      retry(handleType(TransientError), { maxAttempts: 2, backoff: new ConstantBackoff(0) }),
    );

    await expect(
      middleware.handleAsync({ failed: false }, async () => {
        attempts++;
        throw new TransientError('always');
      }),
    ).rejects.toBeInstanceOf(TransientError);

    expect(attempts).toBe(3); // initial + 2 retries
  });

  it('retries on a failure result when isFailure is supplied', async () => {
    let attempts = 0;
    // The policy retries on the sentinel the middleware throws for a failure result.
    const middleware = new CockatielResilienceMiddleware<TestContext>(
      retry(handleType(BenzeneFailureResultException), { maxAttempts: 3, backoff: new ConstantBackoff(0) }),
      (ctx) => ctx.failed,
    );

    const context: TestContext = { failed: false };
    await middleware.handleAsync(context, async () => {
      attempts++;
      context.failed = attempts < 3; // fails (as a result, not a throw) the first two attempts
    });

    expect(attempts).toBe(3);
    expect(context.failed).toBe(false);
  });

  it('swallows the sentinel and leaves the failure result on the context when retries are exhausted', async () => {
    let attempts = 0;
    const middleware = new CockatielResilienceMiddleware<TestContext>(
      retry(handleType(BenzeneFailureResultException), { maxAttempts: 2, backoff: new ConstantBackoff(0) }),
      (ctx) => ctx.failed,
    );

    const context: TestContext = { failed: false };
    // No error escapes even though every attempt "failed": the sentinel is swallowed and the failure
    // result remains observable on the context.
    await middleware.handleAsync(context, async () => {
      attempts++;
      context.failed = true;
    });

    expect(attempts).toBe(3);
    expect(context.failed).toBe(true);
  });

  it('does not retry a failure result when no isFailure predicate is wired', async () => {
    let attempts = 0;
    const middleware = new CockatielResilienceMiddleware<TestContext>(
      retry(handleAll, { maxAttempts: 3, backoff: new ConstantBackoff(0) }),
    );

    const context: TestContext = { failed: false };
    await middleware.handleAsync(context, async () => {
      attempts++;
      context.failed = true; // a failure result, but no predicate wired -> not retried
    });

    expect(attempts).toBe(1);
  });

  // TS-only coverage beyond the retry-only C# suite — exercises the richer policy surface this adapter
  // exists for, and locks the one non-trivial correctness property: the middleware swallows ONLY the
  // sentinel and re-throws every real cockatiel error.
  it('propagates a BrokenCircuitError when the breaker is open, without running next', async () => {
    // ConsecutiveBreaker(1) opens after the first handled failure.
    const middleware = new CockatielResilienceMiddleware<TestContext>(
      circuitBreaker(handleType(TransientError), { halfOpenAfter: 60_000, breaker: new ConsecutiveBreaker(1) }),
    );

    // First call fails and trips the breaker; the real error propagates.
    await expect(
      middleware.handleAsync({ failed: false }, async () => {
        throw new TransientError('boom');
      }),
    ).rejects.toBeInstanceOf(TransientError);

    // With the circuit open, the next call is rejected with cockatiel's BrokenCircuitError WITHOUT
    // running next — proving a real error escapes handleAsync rather than being swallowed as a sentinel.
    let ran = false;
    await expect(
      middleware.handleAsync({ failed: false }, async () => {
        ran = true;
      }),
    ).rejects.toBeInstanceOf(BrokenCircuitError);
    expect(ran).toBe(false);
  });

  it('lets a fallback policy handle a thrown error (the widened-AltReturn path)', async () => {
    // fallback returns a non-void value on a handled error; the middleware ignores the return, so
    // handleAsync resolves rather than throwing. This exercises the IPolicy<..., unknown> typing.
    const middleware = new CockatielResilienceMiddleware<TestContext>(fallback(handleAll, 'fallback-value'));

    await expect(
      middleware.handleAsync({ failed: false }, async () => {
        throw new TransientError('boom');
      }),
    ).resolves.toBeUndefined();
  });
});

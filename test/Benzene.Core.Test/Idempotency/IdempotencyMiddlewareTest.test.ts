import { describe, expect, it } from 'vitest';
import { IDisposable, ILogger, LogLevel, LoggerBase } from '@benzenejs/abstractions';
import { IMessageResult } from '@benzenejs/abstractions-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import {
  ClaimResult,
  IIdempotencyKeyStrategy,
  IIdempotencyStore,
  IdempotencyConflictException,
  IdempotencyMiddleware,
  IdempotencyOptions,
  IdempotencyStatus,
  InMemoryIdempotencyStore,
  InProgressBehavior,
} from '@benzenejs/idempotency';

/** Port of test/Benzene.Core.Test/Idempotency/IdempotencyMiddlewareTest.cs. */

class TestContext {
  messageResult: IMessageResult | undefined = undefined;
}

/** A context with no result concept at all (not `IHasMessageResult`) — no-throw still means success. */
class ResultlessContext {
  topic = 'no-result-signal';
}

class FixedKeyStrategy<TContext> implements IIdempotencyKeyStrategy<TContext> {
  constructor(private readonly key: string | undefined) {}

  getKey(): string | undefined {
    return this.key;
  }
}

/** Records every log call so tests can assert the settle-failure logging. */
class CapturingLogger extends LoggerBase {
  readonly entries: { level: LogLevel; message: string; error?: unknown }[] = [];

  log(logLevel: LogLevel, message: string, error?: unknown): void {
    this.entries.push({ level: logLevel, message, error });
  }

  beginScope(): IDisposable {
    return { dispose: () => {} };
  }
}

/**
 * A test double wrapping a real InMemoryIdempotencyStore that throws (not returns false) from
 * releaseAsync - used to simulate a genuine store failure (as opposed to a fenced "reclaimed" false)
 * settling the release call.
 */
class ThrowsOnReleaseStore implements IIdempotencyStore {
  private readonly inner = new InMemoryIdempotencyStore();

  tryClaimAsync(key: string, signal?: AbortSignal): Promise<ClaimResult> {
    return this.inner.tryClaimAsync(key, signal);
  }

  completeAsync(
    key: string,
    claimToken: string,
    wasSuccessful: boolean,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return this.inner.completeAsync(key, claimToken, wasSuccessful, signal);
  }

  releaseAsync(): Promise<boolean> {
    throw new Error('simulated transient store failure releasing the claim');
  }
}

function middleware(
  store: IIdempotencyStore,
  key: string | undefined = 'key-1',
  options?: IdempotencyOptions,
  logger?: ILogger,
): IdempotencyMiddleware<TestContext> {
  return new IdempotencyMiddleware<TestContext>(
    store,
    new FixedKeyStrategy(key),
    options ?? new IdempotencyOptions(),
    logger,
  );
}

describe('IdempotencyMiddleware', () => {
  it('the first message invokes the handler and records completion', async () => {
    const store = new InMemoryIdempotencyStore();
    let calls = 0;
    const context = new TestContext();

    // A genuinely-completed message: the handler (standing in for a pipeline that runs through the
    // message router) explicitly reports success via messageResult.
    await middleware(store).handleAsync(context, () => {
      calls++;
      context.messageResult = BenzeneResult.ok();
      return Promise.resolve();
    });

    expect(calls).toBe(1);
    const claim = await store.tryClaimAsync('key-1');
    expect(claim.existingRecord!.status).toBe(IdempotencyStatus.Completed);
  });

  it('a duplicate message short-circuits the handler', async () => {
    const store = new InMemoryIdempotencyStore();
    let calls = 0;
    const next = (ctx: TestContext) => () => {
      calls++;
      ctx.messageResult = BenzeneResult.ok();
      return Promise.resolve();
    };

    const first = new TestContext();
    await middleware(store).handleAsync(first, next(first));
    const second = new TestContext();
    await middleware(store).handleAsync(second, next(second));

    expect(calls).toBe(1); // handler ran only for the first copy
  });

  it('a duplicate of a completed message replays a successful result', async () => {
    const store = new InMemoryIdempotencyStore();
    const first = new TestContext();
    await middleware(store).handleAsync(first, () => {
      first.messageResult = BenzeneResult.ok();
      return Promise.resolve();
    });

    const duplicate = new TestContext();
    await middleware(store).handleAsync(duplicate, () => Promise.resolve());

    expect(duplicate.messageResult).toBeDefined();
    expect(duplicate.messageResult!.isSuccessful).toBe(true);
  });

  it('a throwing handler releases the claim so a redelivery reprocesses', async () => {
    const store = new InMemoryIdempotencyStore();
    let calls = 0;

    await expect(
      middleware(store).handleAsync(new TestContext(), () => {
        calls++;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // Claim was released: a redelivery gets a fresh claim and reprocesses.
    const reclaim = await store.tryClaimAsync('key-1');
    expect(reclaim.claimed).toBe(true);
    expect(calls).toBe(1);
  });

  /**
   * The C# #256 rule: `catch { await releaseAsync(...); throw; }` must never let a store failure
   * inside releaseAsync replace the original handler error - that would discard the actual reason
   * the message failed. The original error must always be what propagates.
   */
  it('a throwing handler whose release also throws still propagates the ORIGINAL handler error', async () => {
    const store = new ThrowsOnReleaseStore();
    const logger = new CapturingLogger();

    await expect(
      middleware(store, 'key-1', undefined, logger).handleAsync(new TestContext(), () => {
        throw new Error('the real handler failure');
      }),
    ).rejects.toThrow('the real handler failure');

    // The store failure was logged, not silently swallowed either.
    expect(
      logger.entries.some(
        (e) => e.level === LogLevel.Error && e.message.includes('Releasing idempotency claim'),
      ),
    ).toBe(true);
  });

  it('a handler reporting failure via the result releases the claim', async () => {
    const store = new InMemoryIdempotencyStore();
    const ctx = new TestContext();

    // Handler runs without throwing but the pipeline reports an unsuccessful result.
    await middleware(store).handleAsync(ctx, () => {
      ctx.messageResult = BenzeneResult.unexpectedError();
      return Promise.resolve();
    });

    // The claim was released rather than marked completed, so a redelivery reprocesses.
    expect((await store.tryClaimAsync('key-1')).claimed).toBe(true);
  });

  /**
   * The C# #260 rule: a result-bearing context (`IHasMessageResult`) that completes without EVER
   * setting messageResult (a non-standard pipeline that omits the router or short-circuits before it
   * runs) must NOT be treated as success - the "null == failure, redeliver" convention. Before the
   * fix this fell through to `true` and permanently marked the claim Completed.
   */
  it('completing without setting a result on a result-bearing context releases the claim so a redelivery re-runs', async () => {
    const store = new InMemoryIdempotencyStore();
    let calls = 0;
    const next = () => {
      calls++;
      // Deliberately never sets messageResult.
      return Promise.resolve();
    };

    await middleware(store).handleAsync(new TestContext(), next);

    // The claim was released rather than marked completed, so a redelivery re-runs the handler.
    await middleware(store).handleAsync(new TestContext(), next);
    expect(calls).toBe(2);
  });

  it('a result-less context keeps no-throw == success', async () => {
    const store = new InMemoryIdempotencyStore();
    let calls = 0;
    const mw = new IdempotencyMiddleware<ResultlessContext>(
      store,
      new FixedKeyStrategy('key-1'),
      new IdempotencyOptions(),
    );

    await mw.handleAsync(new ResultlessContext(), () => {
      calls++;
      return Promise.resolve();
    });

    // Recorded completed: the duplicate short-circuits.
    const claim = await store.tryClaimAsync('key-1');
    expect(claim.claimed).toBe(false);
    expect(claim.existingRecord!.status).toBe(IdempotencyStatus.Completed);
    expect(calls).toBe(1);
  });

  it('no key processes normally without touching the store', async () => {
    const store = new InMemoryIdempotencyStore();
    let calls = 0;
    const next = () => {
      calls++;
      return Promise.resolve();
    };
    // Build directly with a no-key strategy: passing `undefined` to the `middleware` helper would hit
    // its default-parameter value instead of meaning "no key".
    const noKey = () =>
      new IdempotencyMiddleware<TestContext>(
        store,
        new FixedKeyStrategy(undefined),
        new IdempotencyOptions(),
      );

    await noKey().handleAsync(new TestContext(), next);
    await noKey().handleAsync(new TestContext(), next);

    expect(calls).toBe(2); // no de-duplication when there is no key
  });

  it('an in-progress duplicate with Throw behavior throws a conflict', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.tryClaimAsync('key-1'); // simulate a sibling still in progress

    const options = new IdempotencyOptions();
    options.inProgressBehavior = InProgressBehavior.Throw;

    await expect(
      middleware(store, 'key-1', options).handleAsync(new TestContext(), () => Promise.resolve()),
    ).rejects.toThrow(IdempotencyConflictException);
  });

  it('an in-progress duplicate with Skip behavior drops silently', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.tryClaimAsync('key-1'); // sibling in progress
    let calls = 0;

    await middleware(store).handleAsync(new TestContext(), () => {
      calls++;
      return Promise.resolve();
    });

    expect(calls).toBe(0); // duplicate dropped, handler not invoked
  });
});

import { describe, expect, it } from 'vitest';
import { IMessageResult } from '@benzene/abstractions-message-handlers';
import { BenzeneResult } from '@benzene/results';
import {
  IIdempotencyKeyStrategy,
  IIdempotencyStore,
  IdempotencyConflictException,
  IdempotencyMiddleware,
  IdempotencyOptions,
  IdempotencyStatus,
  InMemoryIdempotencyStore,
  InProgressBehavior,
} from '@benzene/idempotency';

/** Port of test/Benzene.Core.Test/Idempotency/IdempotencyMiddlewareTest.cs. */

class TestContext {
  messageResult: IMessageResult | undefined = undefined;
}

class FixedKeyStrategy implements IIdempotencyKeyStrategy<TestContext> {
  constructor(private readonly key: string | undefined) {}

  getKey(): string | undefined {
    return this.key;
  }
}

function middleware(
  store: IIdempotencyStore,
  key: string | undefined = 'key-1',
  options?: IdempotencyOptions,
): IdempotencyMiddleware<TestContext> {
  return new IdempotencyMiddleware<TestContext>(
    store,
    new FixedKeyStrategy(key),
    options ?? new IdempotencyOptions(),
  );
}

describe('IdempotencyMiddleware', () => {
  it('the first message invokes the handler and records completion', async () => {
    const store = new InMemoryIdempotencyStore();
    let calls = 0;

    await middleware(store).handleAsync(new TestContext(), () => {
      calls++;
      return Promise.resolve();
    });

    expect(calls).toBe(1);
    const claim = await store.tryClaimAsync('key-1');
    expect(claim.existingRecord!.status).toBe(IdempotencyStatus.Completed);
  });

  it('a duplicate message short-circuits the handler', async () => {
    const store = new InMemoryIdempotencyStore();
    let calls = 0;
    const next = () => {
      calls++;
      return Promise.resolve();
    };

    await middleware(store).handleAsync(new TestContext(), next);
    await middleware(store).handleAsync(new TestContext(), next);

    expect(calls).toBe(1); // handler ran only for the first copy
  });

  it('a duplicate of a completed message replays a successful result', async () => {
    const store = new InMemoryIdempotencyStore();
    await middleware(store).handleAsync(new TestContext(), () => Promise.resolve());

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

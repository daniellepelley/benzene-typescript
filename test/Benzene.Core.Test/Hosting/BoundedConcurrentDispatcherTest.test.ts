import { describe, expect, it } from 'vitest';
import { ILogger, LogLevel } from '@benzene/abstractions';
import { BoundedConcurrentDispatcher } from '@benzene/self-host';
import { FakeLoggerFactory, LogCollector } from '../Logging/Helpers/FakeLoggerFactory';

/**
 * Port of test/Benzene.Core.Test/Hosting/BoundedConcurrentDispatcherTest.cs. C#'s `FakeLogger`/
 * `FakeLogCollector` map to the port's `FakeLoggerFactory`; `Stopwatch` -> `Date.now()`; `Task.Delay`
 * -> a `setTimeout` promise; `TaskCompletionSource` -> a manually-resolved promise (`deferred()`).
 */

function createLogger(): { logger: ILogger; collector: LogCollector } {
  const factory = new FakeLoggerFactory();
  return { logger: factory.createLogger('BoundedConcurrentDispatcherTest'), collector: factory.collector };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A promise plus its resolver - the port's `TaskCompletionSource`. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('BoundedConcurrentDispatcher', () => {
  it('EnqueueAsync_RoundRobin_NeverRunsMoreThanLaneCountConcurrently', async () => {
    const { logger } = createLogger();
    let concurrent = 0;
    let maxObserved = 0;

    const dispatcher = new BoundedConcurrentDispatcher<number>(
      2,
      async () => {
        concurrent++;
        maxObserved = Math.max(maxObserved, concurrent);
        await delay(50);
        concurrent--;
      },
      logger,
    );

    for (let i = 0; i < 6; i++) {
      await dispatcher.enqueueAsync(i);
    }

    await dispatcher.drainAsync(5000);

    expect(maxObserved).toBeGreaterThanOrEqual(2);
    expect(maxObserved).toBeLessThanOrEqual(2);
  });

  it('EnqueueAsync_ItemsSharingAKey_CompleteInEnqueueOrder', async () => {
    const { logger } = createLogger();
    const completionOrder: string[] = [];

    const dispatcher = new BoundedConcurrentDispatcher<{ key: number; value: string; delayMs: number }>(
      3,
      async (item) => {
        await delay(item.delayMs);
        completionOrder.push(item.value);
      },
      logger,
      { keySelector: (item) => item.key },
    );

    // Same key (1), decreasing delays: a naive unordered-parallel dispatch would complete C, B, A. A
    // key-ordered single-consumer lane must still complete A, B, C in enqueue order.
    await dispatcher.enqueueAsync({ key: 1, value: 'A', delayMs: 60 });
    await dispatcher.enqueueAsync({ key: 1, value: 'B', delayMs: 30 });
    await dispatcher.enqueueAsync({ key: 1, value: 'C', delayMs: 10 });

    await dispatcher.drainAsync(5000);

    expect(completionOrder).toEqual(['A', 'B', 'C']);
  });

  it('EnqueueAsync_DifferentKeys_RunConcurrentlyOnDifferentLanes', async () => {
    const { logger } = createLogger();
    let concurrent = 0;
    let maxObserved = 0;

    const dispatcher = new BoundedConcurrentDispatcher<number>(
      4,
      async () => {
        concurrent++;
        maxObserved = Math.max(maxObserved, concurrent);
        await delay(50);
        concurrent--;
      },
      logger,
      { keySelector: (item) => item },
    );

    for (let i = 0; i < 4; i++) {
      await dispatcher.enqueueAsync(i);
    }

    await dispatcher.drainAsync(5000);

    expect(maxObserved).toBeGreaterThan(1);
  });

  it('Dispatch_ExceptionInOneItem_IsLoggedAndDoesNotStopTheLane', async () => {
    const { logger, collector } = createLogger();
    let secondItemRan = false;

    const dispatcher = new BoundedConcurrentDispatcher<number>(
      1,
      (item) => {
        if (item === 1) {
          throw new RangeError('boom');
        }
        secondItemRan = true;
        return Promise.resolve();
      },
      logger,
    );

    await dispatcher.enqueueAsync(1);
    await dispatcher.enqueueAsync(2);

    await dispatcher.drainAsync(5000);

    expect(secondItemRan).toBe(true);
    expect(
      collector.entries.some((e) => e.level === LogLevel.Error && e.error instanceof RangeError),
    ).toBe(true);
  });

  it('Dispatch_CatchExceptionsFalse_ExceptionPropagatesAndInvokesOnFault_LaneStopsConsuming', async () => {
    const { logger, collector } = createLogger();
    let secondItemRan = false;
    let faultSeen: unknown;

    const dispatcher = new BoundedConcurrentDispatcher<number>(
      1,
      (item) => {
        if (item === 1) {
          throw new RangeError('boom');
        }
        secondItemRan = true;
        return Promise.resolve();
      },
      logger,
      {
        catchExceptions: false,
        onFault: (ex) => {
          faultSeen = ex;
        },
      },
    );

    await dispatcher.enqueueAsync(1);
    await dispatcher.enqueueAsync(2);

    await dispatcher.drainAsync(5000);

    expect(secondItemRan).toBe(false);
    expect(faultSeen).toBeInstanceOf(RangeError);
    expect(
      collector.entries.some((e) => e.level === LogLevel.Error && e.error instanceof RangeError),
    ).toBe(true);
  });

  it('DrainAsync_WaitsForInFlightWorkToFinish', async () => {
    const { logger } = createLogger();
    let completed = false;

    const dispatcher = new BoundedConcurrentDispatcher<number>(
      1,
      async () => {
        await delay(200);
        completed = true;
      },
      logger,
    );

    await dispatcher.enqueueAsync(1);

    await dispatcher.drainAsync(5000);

    expect(completed).toBe(true);
  });

  it('DrainAsync_AbandonsInFlightWorkOnceTheTimeoutElapses', async () => {
    const { logger } = createLogger();
    const neverCompletes = deferred();

    const dispatcher = new BoundedConcurrentDispatcher<number>(1, () => neverCompletes.promise, logger);

    await dispatcher.enqueueAsync(1);

    const start = Date.now();
    await dispatcher.drainAsync(100);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(2000);
    neverCompletes.resolve();
  });

  it('DrainLanesAsync_WaitsForOnlyTheTargetedLanesInFlightWork', async () => {
    const { logger } = createLogger();
    const release = deferred();
    let lane0Completed = false;

    // laneCount 2, key selector = the key: key 0 -> lane 0, key 1 -> lane 1.
    const dispatcher = new BoundedConcurrentDispatcher<number>(
      2,
      async (item) => {
        if (item === 0) {
          await release.promise;
          lane0Completed = true;
        }
      },
      logger,
      { keySelector: (item) => item },
    );

    await dispatcher.enqueueAsync(0); // lane 0, blocks until released
    await dispatcher.enqueueAsync(1); // lane 1, completes immediately

    // Draining only lane 1's key returns promptly even though lane 0 is still in flight.
    const start = Date.now();
    await dispatcher.drainLanesAsync([1], 5000);
    const elapsed = Date.now() - start;

    expect(lane0Completed).toBe(false);
    expect(elapsed).toBeLessThan(2000);

    release.resolve();
    await dispatcher.drainAsync(5000);
    expect(lane0Completed).toBe(true);
  });

  it('DrainLanesAsync_ReturnsOnceTheTargetedLaneQuiesces', async () => {
    const { logger } = createLogger();
    let completed = false;

    const dispatcher = new BoundedConcurrentDispatcher<number>(
      2,
      async () => {
        await delay(150);
        completed = true;
      },
      logger,
      { keySelector: (item) => item },
    );

    await dispatcher.enqueueAsync(0);

    await dispatcher.drainLanesAsync([0], 5000);

    expect(completed).toBe(true);
  });

  it('DrainLanesAsync_AfterLaneFaultsWithAQueuedItem_ReturnsPromptly', async () => {
    // Regression: with catchExceptions=false a faulting handler kills its lane consumer; an item already
    // queued in that lane's channel was counted at enqueue and will never be read. Before the fix its
    // phantom outstanding count made every later drainLanesAsync on that lane burn its full timeout. The
    // lane-exit reset clears it.
    const { logger } = createLogger();
    const gate = deferred();

    const dispatcher = new BoundedConcurrentDispatcher<number>(
      1,
      async (item) => {
        if (item === 1) {
          await gate.promise;
          throw new RangeError('boom');
        }
      },
      logger,
      { keySelector: (item) => item, catchExceptions: false, onFault: () => {} },
    );

    await dispatcher.enqueueAsync(1); // read, now in flight awaiting the gate
    await dispatcher.enqueueAsync(2); // sits in the channel behind item 1
    gate.resolve(); // item 1 throws -> lane consumer dies
    await delay(100); // let the lane fault and exit

    const start = Date.now();
    await dispatcher.drainLanesAsync([0], 5000);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(2000);
  });

  it('DrainLanesAsync_ReturnsOnTimeoutWhenWorkNeverFinishes', async () => {
    const { logger } = createLogger();
    const neverCompletes = deferred();

    const dispatcher = new BoundedConcurrentDispatcher<number>(2, () => neverCompletes.promise, logger, {
      keySelector: (item) => item,
    });

    await dispatcher.enqueueAsync(0);

    const start = Date.now();
    await dispatcher.drainLanesAsync([0], 100);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(2000);
    neverCompletes.resolve();
  });
});

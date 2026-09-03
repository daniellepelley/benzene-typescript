import { describe, expect, it } from 'vitest';
import { IBenzeneWorker } from '@benzenejs/abstractions-middleware';
import { CompositeBenzeneWorker } from '@benzenejs/self-host';

/**
 * Port of test/Benzene.Core.Test/Hosting/CompositeBenzeneWorkerTest.cs. The Moq worker is replaced by a
 * hand-rolled fake; the C# deferred LINQ query (`Enumerable.Range(0, 2).Select(_ => MakeWorker())`, which
 * re-mints on each enumeration) becomes an iterable whose `[Symbol.iterator]` re-runs the factory - so
 * the test still proves the composite materializes its sequence exactly once.
 */

describe('CompositeBenzeneWorker', () => {
  it('StopAsync_StopsTheSameWorkerInstancesThatStartAsyncStarted', async () => {
    const startedIds: number[] = [];
    const stoppedIds: number[] = [];
    let nextId = 0;

    function makeWorker(): IBenzeneWorker {
      const id = nextId++;
      return {
        startAsync: () => {
          startedIds.push(id);
          return Promise.resolve();
        },
        stopAsync: () => {
          stoppedIds.push(id);
          return Promise.resolve();
        },
      };
    }

    // Deferred: re-iterating would call makeWorker again, minting new instances - exactly the shape
    // BenzeneWorkerBuilder.createWorker produces.
    const deferred: Iterable<IBenzeneWorker> = {
      *[Symbol.iterator]() {
        for (let i = 0; i < 2; i++) {
          yield makeWorker();
        }
      },
    };
    const composite = new CompositeBenzeneWorker(deferred);

    await composite.startAsync();
    await composite.stopAsync();

    expect(nextId).toBe(2); // only two workers were ever built (not four)
    expect(startedIds).toEqual([0, 1]);
    expect(stoppedIds).toEqual([0, 1]); // the SAME instances, not a fresh set {2, 3}
  });

  // ---- Fault supervision (.NET R17 #291 / CompositeBenzeneWorkerTest.cs) ----

  /** The plain fake: starts/stops synchronously, optionally throwing on start. */
  class FakeWorker implements IBenzeneWorker {
    started = false;
    stopped = false;
    constructor(private readonly throwOnStart = false) {}
    startAsync(): Promise<void> {
      if (this.throwOnStart) {
        throw new Error('boom');
      }
      this.started = true;
      return Promise.resolve();
    }
    stopAsync(): Promise<void> {
      this.stopped = true;
      return Promise.resolve();
    }
  }

  it('StartAsync_WhenAWorkerFails_RollsBackTheStartedWorkers', async () => {
    const good = new FakeWorker();
    const bad = new FakeWorker(true);
    const composite = new CompositeBenzeneWorker([good, bad]);

    await expect(composite.startAsync()).rejects.toThrow('boom');

    expect(good.started).toBe(true);
    expect(good.stopped).toBe(true); // rolled back so a partial start doesn't leak a running worker
  });

  it('StartAsync_WhenAllSucceed_DoesNotStopAnyWorker', async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const composite = new CompositeBenzeneWorker([first, second]);

    await composite.startAsync();

    expect(first.started).toBe(true);
    expect(second.started).toBe(true);
    expect(first.stopped).toBe(false);
    expect(second.stopped).toBe(false);
  });

  /**
   * Mirrors SqsConsumer.startAsync's actual shape: runs its full lifetime inline on the returned
   * promise, which only settles once stopped — it never faults or succeeds on its own. This is the
   * shape that let #291 hide a sibling's startup fault forever behind Promise.all, which only ever
   * settles once EVERY constituent promise has settled.
   */
  class LongRunningWorker implements IBenzeneWorker {
    stopped = false;
    private release!: () => void;
    startAsync(cancellationToken?: AbortSignal): Promise<void> {
      return new Promise<void>((resolve) => {
        this.release = resolve;
        if (cancellationToken?.aborted) {
          resolve();
          return;
        }
        cancellationToken?.addEventListener('abort', () => resolve(), { once: true });
      });
    }
    stopAsync(): Promise<void> {
      this.stopped = true;
      this.release?.();
      return Promise.resolve();
    }
  }

  class ImmediatelyFailingWorker implements IBenzeneWorker {
    constructor(private readonly error = new Error('bad connection string')) {}
    startAsync(): Promise<void> {
      return Promise.reject(this.error);
    }
    stopAsync(): Promise<void> {
      return Promise.resolve();
    }
  }

  /** Starts cleanly (its start promise stays pending) but faults mid-lifetime rather than at startup. */
  class LateFaultingWorker implements IBenzeneWorker {
    stopped = false;
    private reject!: (error: unknown) => void;
    startAsync(): Promise<void> {
      return new Promise<void>((_resolve, reject) => {
        this.reject = reject;
      });
    }
    fault(error: unknown): void {
      this.reject(error);
    }
    stopAsync(): Promise<void> {
      this.stopped = true;
      return Promise.resolve();
    }
  }

  it('StartAsync_LongRunningSiblingFailsToStart_FaultsPromptlyAndStopsTheLongRunningSibling', async () => {
    const longRunning = new LongRunningWorker();
    const failing = new ImmediatelyFailingWorker();
    const composite = new CompositeBenzeneWorker([longRunning, failing]);

    const startPromise = composite.startAsync();

    // Expected to fault promptly instead of hanging behind the never-settling long-running sibling
    // (#291) — raced against a timeout so a regression fails rather than wedging the suite.
    const winner = await Promise.race([
      startPromise.then(
        () => 'resolved',
        (error: unknown) => error,
      ),
      new Promise((resolve) => setTimeout(() => resolve('timed out'), 5000)),
    ]);

    expect(winner).toBeInstanceOf(Error);
    expect((winner as Error).message).toBe('bad connection string');

    // The rollback predicate must stop a sibling that is still running — not only one that already
    // completed successfully — otherwise this exact long-running shape is skipped.
    expect(longRunning.stopped).toBe(true);
  });

  it('StartAsync_SiblingFaultsAfterStartingSuccessfully_FaultsPromptlyAndRollsBackTheSibling', async () => {
    const lateFaulting = new LateFaultingWorker();
    const goodButLongRunning = new LongRunningWorker();
    const composite = new CompositeBenzeneWorker([goodButLongRunning, lateFaulting]);

    const startPromise = composite.startAsync();
    const outcome = startPromise.then(
      () => 'resolved',
      (error: unknown) => error,
    );

    // Give both workers a moment to be "running" before the mid-lifetime fault — this is not a
    // startup-time fault, it happens after the composite has already started everyone.
    await new Promise((resolve) => setTimeout(resolve, 50));
    lateFaulting.fault(new Error('connection dropped'));

    const winner = await Promise.race([
      outcome,
      new Promise((resolve) => setTimeout(() => resolve('timed out'), 5000)),
    ]);

    expect(winner).toBeInstanceOf(Error);
    expect((winner as Error).message).toBe('connection dropped');
    expect(goodButLongRunning.stopped).toBe(true);
  });

  it('rollback keeps going when a sibling stop also fails, and the ORIGINAL fault propagates', async () => {
    // The .NET rollback swallows a stop fault so it can never mask the start failure.
    const stopFails: IBenzeneWorker = {
      startAsync: () => Promise.resolve(),
      stopAsync: () => Promise.reject(new Error('stop blew up')),
    };
    const good = new FakeWorker();
    const bad = new ImmediatelyFailingWorker(new Error('the real failure'));
    const composite = new CompositeBenzeneWorker([stopFails, good, bad]);

    await expect(composite.startAsync()).rejects.toThrow('the real failure');
    expect(good.stopped).toBe(true); // the stop fault on the first sibling didn't abort rollback
  });
});

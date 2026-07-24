import { describe, expect, it } from 'vitest';
import { IBenzeneWorker } from '@benzene/abstractions-middleware';
import { CompositeBenzeneWorker } from '@benzene/self-host';

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
});

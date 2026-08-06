import { describe, expect, it } from 'vitest';
import {
  ChangeFeedItem,
  ChangeFeedProcessorContext,
  CosmosChangeFeedProcessorFactory,
  CosmosChangeFeedSource,
  ICosmosChangeFeedCheckpointStore,
} from '@benzene/azure-cosmos-db';

/**
 * Net-new coverage for the change-feed-processor fork (no C# counterpart — the .NET tests mock the
 * factory interface because the SDK's push-model processor is untestable without the emulator). Here the
 * built-in {@link CosmosChangeFeedProcessorFactory} drives the pull iterator over a FAKE container:
 * a page is delivered to the handler, the continuation token is persisted as the checkpoint, a
 * `readNext` failure surfaces to `onError`, and the all-versions path auto-persists after success.
 */

interface OrderDocument {
  id: string;
}

interface FakePage {
  result: unknown[];
  count: number;
  statusCode: number;
  continuationToken: string;
}

/** A container whose change-feed iterator returns `pages` in order (repeating the last one). */
function fakeSource(pages: FakePage[]): CosmosChangeFeedSource {
  let call = 0;
  const iterator = {
    hasMoreResults: true,
    readNext: (): Promise<never> => {
      const page = pages[Math.min(call, pages.length - 1)];
      call++;
      return Promise.resolve(page as never);
    },
    getAsyncIterator: (): never => {
      throw new Error('unused');
    },
  };
  return { items: { getChangeFeedIterator: () => iterator as never } };
}

class InMemoryCheckpointStore implements ICosmosChangeFeedCheckpointStore {
  readonly tokens = new Map<string, string>();

  readContinuationToken(leaseToken: string): Promise<string | undefined> {
    return Promise.resolve(this.tokens.get(leaseToken));
  }

  writeContinuationToken(leaseToken: string, continuationToken: string): Promise<void> {
    this.tokens.set(leaseToken, continuationToken);
    return Promise.resolve();
  }
}

const notModified: FakePage = { result: [], count: 0, statusCode: 304, continuationToken: 'token-1' };

describe('CosmosChangeFeedProcessorFactory (pull-iterator poll loop)', () => {
  it('delivers a page to the handler and persists the continuation token as the checkpoint', async () => {
    const store = new InMemoryCheckpointStore();
    const source = fakeSource([
      { result: [{ id: 'o1' }], count: 1, statusCode: 200, continuationToken: 'token-1' },
      notModified,
    ]);
    const factory = new CosmosChangeFeedProcessorFactory<OrderDocument>(source, store, {
      pollIntervalMs: 5,
      leaseToken: 'lease-A',
    });

    let deliveredContext: ChangeFeedProcessorContext | undefined;
    let deliveredPage: readonly OrderDocument[] | undefined;
    let resolveDelivered: () => void;
    const delivered = new Promise<void>((resolve) => {
      resolveDelivered = resolve;
    });

    const processor = factory.create(
      async (context, changes, checkpointAsync) => {
        deliveredContext = context;
        deliveredPage = changes;
        await checkpointAsync();
        resolveDelivered();
      },
      () => Promise.resolve(),
    );

    await processor.startAsync();
    await delivered;
    await processor.stopAsync();

    expect(deliveredContext?.leaseToken).toBe('lease-A');
    expect(deliveredPage?.map((d) => d.id)).toEqual(['o1']);
    expect(store.tokens.get('lease-A')).toBe('token-1');
  });

  it('surfaces a readNext failure to onError', async () => {
    const store = new InMemoryCheckpointStore();
    const boom = new Error('read failed');
    let call = 0;
    const source: CosmosChangeFeedSource = {
      items: {
        getChangeFeedIterator: () =>
          ({
            hasMoreResults: true,
            readNext: (): Promise<never> => {
              call++;
              return call === 1 ? Promise.reject(boom) : Promise.resolve(notModified as never);
            },
            getAsyncIterator: (): never => {
              throw new Error('unused');
            },
          }) as never,
      },
    };
    const factory = new CosmosChangeFeedProcessorFactory<OrderDocument>(source, store, { pollIntervalMs: 5 });

    let capturedError: unknown;
    let resolveErrored: () => void;
    const errored = new Promise<void>((resolve) => {
      resolveErrored = resolve;
    });
    const processor = factory.create(
      () => Promise.resolve(),
      (_leaseToken, error) => {
        capturedError = error;
        resolveErrored();
        return Promise.resolve();
      },
    );

    await processor.startAsync();
    await errored;
    await processor.stopAsync();

    expect(capturedError).toBe(boom);
  });

  it('rewinds and redelivers the batch when the handler throws (at-least-once)', async () => {
    const store = new InMemoryCheckpointStore();
    // Each iterator instance delivers the batch once, then reports NotModified. A throw recreates the
    // iterator (rewinding to the last durable checkpoint — here, none), so the batch is redelivered.
    const source: CosmosChangeFeedSource = {
      items: {
        getChangeFeedIterator: () => {
          let firstCall = true;
          return {
            hasMoreResults: true,
            readNext: (): Promise<never> => {
              if (firstCall) {
                firstCall = false;
                return Promise.resolve({
                  result: [{ id: 'o1' }],
                  count: 1,
                  statusCode: 200,
                  continuationToken: 'token-1',
                } as never);
              }
              return Promise.resolve(notModified as never);
            },
            getAsyncIterator: (): never => {
              throw new Error('unused');
            },
          } as never;
        },
      },
    };
    const factory = new CosmosChangeFeedProcessorFactory<OrderDocument>(source, store, {
      pollIntervalMs: 5,
      leaseToken: 'lease-C',
    });

    const deliveries: string[] = [];
    let errorCount = 0;
    let resolveSecond: () => void;
    const secondDelivery = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });

    const processor = factory.create(
      async (_context, changes, checkpointAsync) => {
        deliveries.push(...changes.map((d) => d.id));
        if (deliveries.length === 1) {
          throw new Error('handler failed'); // reject the first delivery
        }
        await checkpointAsync(); // second delivery succeeds and checkpoints
        resolveSecond();
      },
      (_leaseToken) => {
        errorCount++;
        return Promise.resolve();
      },
    );

    await processor.startAsync();
    await secondDelivery;
    await processor.stopAsync();

    // Same batch delivered twice; the failure surfaced to onError; the redelivery checkpointed.
    expect(deliveries).toEqual(['o1', 'o1']);
    expect(errorCount).toBe(1);
    expect(store.tokens.get('lease-C')).toBe('token-1');
  });

  it('all-versions path auto-persists the continuation token after a successful handler', async () => {
    const store = new InMemoryCheckpointStore();
    const change: ChangeFeedItem<OrderDocument> = {
      current: { id: 'o1' },
      previous: undefined,
      metadata: { operationType: 'create' },
    };
    const source = fakeSource([
      { result: [change], count: 1, statusCode: 200, continuationToken: 'token-9' },
      notModified,
    ]);
    const factory = new CosmosChangeFeedProcessorFactory<OrderDocument>(source, store, {
      pollIntervalMs: 5,
      leaseToken: 'lease-B',
    });

    let deliveredPage: readonly ChangeFeedItem<OrderDocument>[] | undefined;
    let resolveDelivered: () => void;
    const delivered = new Promise<void>((resolve) => {
      resolveDelivered = resolve;
    });
    const processor = factory.createAllVersionsAndDeletes(
      (_context, changes) => {
        deliveredPage = changes;
        resolveDelivered();
        return Promise.resolve();
      },
      () => Promise.resolve(),
    );

    await processor.startAsync();
    await delivered;
    // Give the loop a microtask turn to run the post-handler auto-persist.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await processor.stopAsync();

    expect(deliveredPage?.map((c) => c.current.id)).toEqual(['o1']);
    expect(store.tokens.get('lease-B')).toBe('token-9');
  });
});

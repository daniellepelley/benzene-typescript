import { describe, expect, it } from 'vitest';
import { IServiceResolverFactory } from '@benzenejs/abstractions';
import { IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { StreamContext } from '@benzenejs/core-middleware';
import { addBenzene } from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import {
  BenzeneCosmosAllVersionsChangeFeedConfig,
  BenzeneCosmosAllVersionsChangeFeedWorker,
  ChangeFeedHandler,
  ChangeFeedItem,
  ChangeFeedMonitorErrorDelegate,
  ChangeFeedOperationType,
  ChangeFeedProcessor,
  ChangeFeedProcessorContext,
  CosmosAllVersionsChangeFeedApplication,
  CosmosChangeFeedItem,
  CosmosChangeType,
  ICosmosChangeFeedProcessorFactory,
} from '@benzenejs/azure-cosmos-db';

/**
 * Port of Benzene.Core.Test/Azure/CosmosDbWorker/BenzeneCosmosAllVersionsChangeFeedWorkerTest.cs:
 * all-versions processor created + started, change items mapped (incl. delete + previous state), and
 * skip-vs-retry (and shutdown-cancellation-propagates) on failure — driven by capturing the delegates
 * the worker hands the faked factory. No live Cosmos.
 */

class OrderDocument {
  id: string | undefined;
}

function item(
  current: OrderDocument,
  previous: OrderDocument | undefined,
  operationType: ChangeFeedOperationType,
): ChangeFeedItem<OrderDocument> {
  return { current, previous, metadata: { operationType } };
}

function createResolverFactory(): IServiceResolverFactory {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  return container.createServiceResolverFactory();
}

class Harness {
  pipeline: IMiddlewarePipeline<StreamContext<CosmosChangeFeedItem<OrderDocument>>> = {
    handleAsync: () => Promise.resolve(),
  };
  startCalls = 0;
  stopCalls = 0;
  createAllVersionsCalls = 0;
  onChanges: ChangeFeedHandler<ChangeFeedItem<OrderDocument>> | undefined;
  onError: ChangeFeedMonitorErrorDelegate | undefined;
  readonly worker: BenzeneCosmosAllVersionsChangeFeedWorker<OrderDocument>;

  private readonly processor: ChangeFeedProcessor = {
    startAsync: () => {
      this.startCalls++;
      return Promise.resolve();
    },
    stopAsync: () => {
      this.stopCalls++;
      return Promise.resolve();
    },
  };

  private readonly factory: ICosmosChangeFeedProcessorFactory<OrderDocument> = {
    create: () => {
      throw new Error('not used');
    },
    createAllVersionsAndDeletes: (onChanges, onError) => {
      this.createAllVersionsCalls++;
      this.onChanges = onChanges;
      this.onError = onError;
      return this.processor;
    },
  };

  constructor(config: BenzeneCosmosAllVersionsChangeFeedConfig) {
    const application = new CosmosAllVersionsChangeFeedApplication<OrderDocument>({
      handleAsync: (context, resolver) => this.pipeline.handleAsync(context, resolver),
    });
    this.worker = new BenzeneCosmosAllVersionsChangeFeedWorker<OrderDocument>(
      createResolverFactory(),
      application,
      config,
      this.factory,
    );
  }

  deliverBatch(...changes: ChangeFeedItem<OrderDocument>[]): Promise<void> {
    const context: ChangeFeedProcessorContext = { leaseToken: '0' };
    return this.onChanges!(context, changes, undefined);
  }
}

describe('BenzeneCosmosAllVersionsChangeFeedWorker', () => {
  it('config defaults catchHandlerExceptions false', () => {
    expect(new BenzeneCosmosAllVersionsChangeFeedConfig().catchHandlerExceptions).toBe(false);
  });

  it('startAsync creates the all-versions processor and starts it', async () => {
    const harness = new Harness(new BenzeneCosmosAllVersionsChangeFeedConfig());

    await harness.worker.startAsync();

    expect(harness.createAllVersionsCalls).toBe(1);
    expect(harness.onChanges).toBeDefined();
    expect(harness.startCalls).toBe(1);
  });

  it('delivered batch maps change items, including deletes and previous state', async () => {
    const harness = new Harness(new BenzeneCosmosAllVersionsChangeFeedConfig());
    let captured: StreamContext<CosmosChangeFeedItem<OrderDocument>> | undefined;
    harness.pipeline = {
      handleAsync: (context) => {
        captured = context;
        return Promise.resolve();
      },
    };
    await harness.worker.startAsync();

    await harness.deliverBatch(
      item(Object.assign(new OrderDocument(), { id: 'o1' }), undefined, ChangeFeedOperationType.Create),
      item(
        Object.assign(new OrderDocument(), { id: 'o2' }),
        Object.assign(new OrderDocument(), { id: 'o2' }),
        ChangeFeedOperationType.Replace,
      ),
      item(
        Object.assign(new OrderDocument(), { id: 'o3' }),
        Object.assign(new OrderDocument(), { id: 'o3' }),
        ChangeFeedOperationType.Delete,
      ),
    );

    expect(captured).toBeDefined();
    const items: CosmosChangeFeedItem<OrderDocument>[] = [];
    for await (const change of captured!.items) {
      items.push(change);
    }

    expect(items).toHaveLength(3);
    expect(items[0].changeType).toBe(CosmosChangeType.Create);
    expect(items[0].current.id).toBe('o1');
    expect(items[1].changeType).toBe(CosmosChangeType.Replace);
    expect(items[2].changeType).toBe(CosmosChangeType.Delete);
    expect(items[2].previous!.id).toBe('o3'); // previous state retained on delete
    expect(captured!.metadata[CosmosAllVersionsChangeFeedApplication.LeaseTokenMetadataKey]).toBe('0');
  });

  it('failed batch, default rethrows, so the processor does not checkpoint', async () => {
    const harness = new Harness(new BenzeneCosmosAllVersionsChangeFeedConfig());
    harness.pipeline = { handleAsync: () => Promise.reject(new Error('handler failed')) };
    await harness.worker.startAsync();

    await expect(
      harness.deliverBatch(
        item(Object.assign(new OrderDocument(), { id: 'o1' }), undefined, ChangeFeedOperationType.Create),
      ),
    ).rejects.toThrow('handler failed');
  });

  it('failed batch, catchHandlerExceptions swallows so the processor checkpoints', async () => {
    const harness = new Harness(new BenzeneCosmosAllVersionsChangeFeedConfig({ catchHandlerExceptions: true }));
    harness.pipeline = { handleAsync: () => Promise.reject(new Error('handler failed')) };
    await harness.worker.startAsync();

    // No throw: swallowing lets the automatic checkpoint advance past the poison batch.
    await expect(
      harness.deliverBatch(
        item(Object.assign(new OrderDocument(), { id: 'o1' }), undefined, ChangeFeedOperationType.Create),
      ),
    ).resolves.toBeUndefined();
  });

  it('skip mode, shutdown cancellation propagates, so the batch is not checkpointed', async () => {
    // Even with catchHandlerExceptions=true (skip mode), a genuine shutdown cancellation must propagate
    // so the automatic-checkpoint processor doesn't checkpoint a partial batch.
    const harness = new Harness(new BenzeneCosmosAllVersionsChangeFeedConfig({ catchHandlerExceptions: true }));
    const controller = new AbortController();
    controller.abort();
    const cancellation = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    harness.pipeline = { handleAsync: () => Promise.reject(cancellation) };
    await harness.worker.startAsync();

    const context: ChangeFeedProcessorContext = { leaseToken: '0' };
    await expect(
      harness.onChanges!(
        context,
        [item(Object.assign(new OrderDocument(), { id: 'o1' }), undefined, ChangeFeedOperationType.Create)],
        controller.signal,
      ),
    ).rejects.toBe(cancellation);
  });

  it('stopAsync after start stops the processor', async () => {
    const harness = new Harness(new BenzeneCosmosAllVersionsChangeFeedConfig());
    await harness.worker.startAsync();

    await harness.worker.stopAsync();

    expect(harness.stopCalls).toBe(1);
  });
});

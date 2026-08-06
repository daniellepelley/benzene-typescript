import { describe, expect, it } from 'vitest';
import { IServiceResolverFactory } from '@benzene/abstractions';
import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { StreamContext } from '@benzene/core-middleware';
import { addBenzene } from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import {
  BenzeneCosmosChangeFeedConfig,
  BenzeneCosmosChangeFeedWorker,
  ChangeFeedHandlerWithManualCheckpoint,
  ChangeFeedMonitorErrorDelegate,
  ChangeFeedProcessor,
  ChangeFeedProcessorContext,
  CosmosChangeFeedApplication,
  ICosmosChangeFeedProcessorFactory,
} from '@benzene/azure-cosmos-db';

/**
 * Port of Benzene.Core.Test/Azure/CosmosDbWorker/BenzeneCosmosChangeFeedWorkerTest.cs: config defaults,
 * start/stop lifecycle, and every auto-checkpoint/skip/retry combination — driven by capturing the
 * delegates the worker hands the (faked) processor factory, exactly as the C# test captures them off a
 * mocked `ChangeFeedProcessor`/factory. No live Cosmos: the worker's SDK-facing seam is the factory
 * interface, faked here.
 */

class OrderDocument {
  id: string | undefined;
}

/** A real container with the base benzene services (so the transport pipeline's `ISetCurrentTransport` resolves). */
function createResolverFactory(): IServiceResolverFactory {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  return container.createServiceResolverFactory();
}

class Harness {
  pipeline: IMiddlewarePipeline<StreamContext<OrderDocument>> = { handleAsync: () => Promise.resolve() };
  startCalls = 0;
  stopCalls = 0;
  checkpointCalls = 0;
  onChanges: ChangeFeedHandlerWithManualCheckpoint<OrderDocument> | undefined;
  onError: ChangeFeedMonitorErrorDelegate | undefined;
  readonly worker: BenzeneCosmosChangeFeedWorker<OrderDocument>;

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
    create: (onChanges, onError) => {
      this.onChanges = onChanges;
      this.onError = onError;
      return this.processor;
    },
    createAllVersionsAndDeletes: () => {
      throw new Error('not used');
    },
  };

  constructor(config: BenzeneCosmosChangeFeedConfig) {
    // The application defers to `this.pipeline` at delivery time, so a test can install its pipeline
    // behaviour after construction.
    const application = new CosmosChangeFeedApplication<OrderDocument>({
      handleAsync: (context, resolver) => this.pipeline.handleAsync(context, resolver),
    });
    this.worker = new BenzeneCosmosChangeFeedWorker<OrderDocument>(
      createResolverFactory(),
      application,
      config,
      this.factory,
    );
  }

  deliverBatch(...ids: string[]): Promise<void> {
    const documents = ids.map((id) => Object.assign(new OrderDocument(), { id }));
    const context: ChangeFeedProcessorContext = { leaseToken: '0' };
    return this.onChanges!(context, documents, () => {
      this.checkpointCalls++;
      return Promise.resolve();
    }, undefined);
  }
}

describe('BenzeneCosmosChangeFeedWorker', () => {
  it('BenzeneCosmosChangeFeedConfig defaults', () => {
    const config = new BenzeneCosmosChangeFeedConfig();
    expect(config.autoCheckpointOnSuccess).toBe(true);
    expect(config.catchHandlerExceptions).toBe(false);
  });

  it('startAsync creates the processor with handlers and starts it', async () => {
    const harness = new Harness(new BenzeneCosmosChangeFeedConfig());

    await harness.worker.startAsync();

    expect(harness.onChanges).toBeDefined();
    expect(harness.onError).toBeDefined();
    expect(harness.startCalls).toBe(1);
  });

  it('stopAsync before start is a no-op', async () => {
    const harness = new Harness(new BenzeneCosmosChangeFeedConfig());

    await harness.worker.stopAsync();

    expect(harness.stopCalls).toBe(0);
  });

  it('stopAsync after start stops the processor', async () => {
    const harness = new Harness(new BenzeneCosmosChangeFeedConfig());
    await harness.worker.startAsync();

    await harness.worker.stopAsync();

    expect(harness.stopCalls).toBe(1);
  });

  it('successful batch, handler did not checkpoint, auto-checkpoints by default', async () => {
    const harness = new Harness(new BenzeneCosmosChangeFeedConfig());
    await harness.worker.startAsync();

    await harness.deliverBatch('order-1', 'order-2');

    expect(harness.checkpointCalls).toBe(1);
  });

  it('successful batch, auto-checkpoint disabled, does not checkpoint', async () => {
    const harness = new Harness(new BenzeneCosmosChangeFeedConfig({ autoCheckpointOnSuccess: false }));
    await harness.worker.startAsync();

    await harness.deliverBatch('order-1');

    expect(harness.checkpointCalls).toBe(0);
  });

  it('handler checkpoints itself, no second auto-checkpoint', async () => {
    const harness = new Harness(new BenzeneCosmosChangeFeedConfig());
    harness.pipeline = {
      handleAsync: (context) =>
        (context as StreamContext<OrderDocument>).checkpointer.checkpointAsync(
          Object.assign(new OrderDocument(), { id: 'order-1' }),
        ),
    };
    await harness.worker.startAsync();

    await harness.deliverBatch('order-1');

    expect(harness.checkpointCalls).toBe(1);
  });

  it('failed batch, default rethrows without checkpointing, so the batch is redelivered', async () => {
    const harness = new Harness(new BenzeneCosmosChangeFeedConfig());
    harness.pipeline = { handleAsync: () => Promise.reject(new Error('handler failed')) };
    await harness.worker.startAsync();

    await expect(harness.deliverBatch('order-1')).rejects.toThrow('handler failed');
    expect(harness.checkpointCalls).toBe(0);
  });

  it('failed batch, catchHandlerExceptions checkpoints and continues, skipping the batch', async () => {
    const harness = new Harness(new BenzeneCosmosChangeFeedConfig({ catchHandlerExceptions: true }));
    harness.pipeline = { handleAsync: () => Promise.reject(new Error('handler failed')) };
    await harness.worker.startAsync();

    await harness.deliverBatch('order-1');

    expect(harness.checkpointCalls).toBe(1);
  });

  it('onError logs and completes', async () => {
    const harness = new Harness(new BenzeneCosmosChangeFeedConfig());
    await harness.worker.startAsync();

    await expect(harness.onError!('0', new Error('lease failed'))).resolves.toBeUndefined();
  });
});

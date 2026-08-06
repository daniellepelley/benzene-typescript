import { describe, expect, it } from 'vitest';
import { addBenzene } from '@benzene/core-message-handlers';
import { MiddlewarePipelineBuilder, StreamContext, useStream } from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import {
  CosmosChangeFeedApplication,
  CosmosChangeFeedBatch,
} from '@benzene/azure-cosmos-db';

/**
 * Port of Benzene.Core.Test/Azure/CosmosDbWorker/CosmosChangeFeedApplicationTest.cs: fan-in
 * ordering/single-run, checkpointer wiring + `hasCheckpointed` reporting, lease-token metadata +
 * cancellation flow, and exception propagation — over a real streaming pipeline.
 */

class OrderDocument {
  id: string | undefined;
}

function createContainer(): DefaultBenzeneServiceContainer {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  return container;
}

function createBatch(
  ids: string[],
  checkpointAsync: () => Promise<void> = () => Promise.resolve(),
  leaseToken = '0',
  cancellationToken?: AbortSignal,
): CosmosChangeFeedBatch<OrderDocument> {
  const documents = ids.map((id) => Object.assign(new OrderDocument(), { id }));
  return new CosmosChangeFeedBatch<OrderDocument>(documents, checkpointAsync, leaseToken, cancellationToken);
}

describe('CosmosChangeFeedApplication', () => {
  it('delivers the batch as one ordered stream in a single run, not checkpointed by default', async () => {
    const collected: (string | undefined)[] = [];
    let runs = 0;
    let checkpointCalls = 0;

    const container = createContainer();
    const pipeline = useStream<OrderDocument>(
      new MiddlewarePipelineBuilder<StreamContext<OrderDocument>>(container),
      async (documents: AsyncIterable<OrderDocument>, _signal: AbortSignal | undefined) => {
        runs++;
        for await (const document of documents) {
          collected.push(document.id);
        }
      },
    ).build();
    const application = new CosmosChangeFeedApplication<OrderDocument>(pipeline);

    const batch = createBatch(['order-1', 'order-2', 'order-3'], () => {
      checkpointCalls++;
      return Promise.resolve();
    });
    const handlerCheckpointed = await application.handleAsync(
      batch,
      container.createServiceResolverFactory(),
    );

    expect(runs).toBe(1);
    expect(collected).toEqual(['order-1', 'order-2', 'order-3']);
    // The application itself never checkpoints — that's the worker's (or the handler's) call.
    expect(handlerCheckpointed).toBe(false);
    expect(checkpointCalls).toBe(0);
  });

  it('handler checkpoints: invokes the batch checkpoint hook and reports it', async () => {
    let checkpointCalls = 0;

    const container = createContainer();
    const pipeline = useStream<OrderDocument>(
      new MiddlewarePipelineBuilder<StreamContext<OrderDocument>>(container),
      async (context) => {
        for await (const document of context.items) {
          // Batch-level: the item passed is ignored, the whole batch is acknowledged.
          await context.checkpointer.checkpointAsync(document);
        }
      },
    ).build();
    const application = new CosmosChangeFeedApplication<OrderDocument>(pipeline);

    const batch = createBatch(['order-1'], () => {
      checkpointCalls++;
      return Promise.resolve();
    });
    const handlerCheckpointed = await application.handleAsync(
      batch,
      container.createServiceResolverFactory(),
    );

    expect(handlerCheckpointed).toBe(true);
    expect(checkpointCalls).toBe(1);
  });

  it('context carries lease-token metadata and cancellation signal', async () => {
    let observed: StreamContext<OrderDocument> | undefined;

    const container = createContainer();
    const pipeline = useStream<OrderDocument>(
      new MiddlewarePipelineBuilder<StreamContext<OrderDocument>>(container),
      (context) => {
        observed = context;
        return Promise.resolve();
      },
    ).build();
    const application = new CosmosChangeFeedApplication<OrderDocument>(pipeline);

    const controller = new AbortController();
    const batch = createBatch(['order-1'], () => Promise.resolve(), 'some-lease', controller.signal);
    await application.handleAsync(batch, container.createServiceResolverFactory());

    expect(observed).toBeDefined();
    expect(observed!.metadata[CosmosChangeFeedApplication.LeaseTokenMetadataKey]).toBe('some-lease');
    expect(observed!.signal).toBe(controller.signal);
  });

  it('pipeline throws: exception propagates', async () => {
    const container = createContainer();
    const pipeline = useStream<OrderDocument>(
      new MiddlewarePipelineBuilder<StreamContext<OrderDocument>>(container),
      () => {
        throw new Error('handler failed');
      },
    ).build();
    const application = new CosmosChangeFeedApplication<OrderDocument>(pipeline);

    await expect(
      application.handleAsync(createBatch(['order-1']), container.createServiceResolverFactory()),
    ).rejects.toThrow('handler failed');
  });
});

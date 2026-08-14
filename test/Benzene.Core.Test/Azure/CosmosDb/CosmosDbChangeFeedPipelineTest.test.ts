import { describe, expect, it } from 'vitest';
import { useStream } from '@benzenejs/core-middleware';
import { addBenzene } from '@benzenejs/core-message-handlers';
import { InlineAzureFunctionStartUp } from '@benzenejs/azure-function-core';
import { handleCosmosDbChanges, useCosmosDbChangeFeed } from '@benzenejs/azure-function-cosmos-db';

/**
 * End-to-end port of the C# Cosmos DB Change Feed pipeline tests (CosmosDbChangeFeedPipelineTest.cs): the
 * whole triggered batch of changed documents is presented to the pipeline as a single ordered
 * `StreamContext<TDocument>` (fan-in) and run once. Cosmos DB delivers already-deserialized documents, so
 * the pipeline is generic over the document type.
 *
 * NOT PORTED (see index.ts): the C# `TwoDocumentTypes_RouteToTheirOwnPipelines` /
 * `UnregisteredDocumentType_Throws` scenarios rely on C# runtime generic type dispatch, which TypeScript
 * erases — the ported `AzureFunctionApp.handleAsync` dispatches to the first fire-and-forget entry point
 * regardless of document type. The `PlatformNeutralOverload_NoOpsOnNonAzureBuilders` test is also not
 * ported (the host-neutral `useCosmosDbChangeFeed(IBenzeneApplicationBuilder, ...)` overload is deferred).
 */

class OrderDocument {
  id: string | undefined;
  total: number | undefined;
}

describe('CosmosDbChangeFeedPipeline (via AzureFunctionApp entry point)', () => {
  it('delivers the change-feed batch as one ordered stream in a single run', async () => {
    const collected: (string | undefined)[] = [];
    let runs = 0;

    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useCosmosDbChangeFeed<OrderDocument>(builder, (feed) =>
          useStream<OrderDocument>(feed, async (documents: AsyncIterable<OrderDocument>, _signal: AbortSignal | undefined) => {
            runs++;
            for await (const document of documents) {
              collected.push(document.id);
            }
          }),
        ),
      )
      .build();

    await handleCosmosDbChanges<OrderDocument>(app, [
      Object.assign(new OrderDocument(), { id: 'order-1' }),
      Object.assign(new OrderDocument(), { id: 'order-2' }),
      Object.assign(new OrderDocument(), { id: 'order-3' }),
    ]);

    expect(runs).toBe(1);
    expect(collected).toEqual(['order-1', 'order-2', 'order-3']);
  });

  it('runs the pipeline once with no items for an empty batch', async () => {
    const collected: OrderDocument[] = [];
    let runs = 0;

    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useCosmosDbChangeFeed<OrderDocument>(builder, (feed) =>
          useStream<OrderDocument>(feed, async (documents: AsyncIterable<OrderDocument>, _signal: AbortSignal | undefined) => {
            runs++;
            for await (const document of documents) {
              collected.push(document);
            }
          }),
        ),
      )
      .build();

    await handleCosmosDbChanges<OrderDocument>(app, []);

    expect(runs).toBe(1);
    expect(collected).toEqual([]);
  });

  it('treats a null batch as empty', async () => {
    let runs = 0;

    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useCosmosDbChangeFeed<OrderDocument>(builder, (feed) =>
          useStream<OrderDocument>(feed, async (documents: AsyncIterable<OrderDocument>, _signal: AbortSignal | undefined) => {
            runs++;
            for await (const _document of documents) {
              // drain
            }
          }),
        ),
      )
      .build();

    await handleCosmosDbChanges<OrderDocument>(app, null as unknown as readonly OrderDocument[]);

    expect(runs).toBe(1);
  });

  it('propagates a handler exception to the caller, so the trigger retains its lease', async () => {
    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useCosmosDbChangeFeed<OrderDocument>(builder, (feed) =>
          useStream<OrderDocument>(feed, () => {
            throw new Error('handler failed');
          }),
        ),
      )
      .build();

    await expect(
      handleCosmosDbChanges<OrderDocument>(app, [
        Object.assign(new OrderDocument(), { id: 'order-1' }),
      ]),
    ).rejects.toThrow('handler failed');
  });
});

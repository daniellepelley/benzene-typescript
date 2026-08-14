/** Port of Benzene.Azure.Function.CosmosDb.StreamingExtensions. */
import { IServiceResolverFactory } from '@benzenejs/abstractions';
import { PipelineBuilderAction } from '@benzenejs/abstractions-middleware';
import {
  EntryPointMiddlewareApplication,
  StreamContext,
  StreamMiddlewareApplication,
} from '@benzenejs/core-middleware';
import { IAzureFunctionAppBuilder } from '@benzenejs/azure-function-core';

/**
 * Adds Cosmos DB Change Feed handling: the whole triggered batch of changed documents is presented to
 * the pipeline as a single `StreamContext<TDocument>` (fan-in), preserving the change feed's
 * per-partition-key-range ordering and enabling windowing/aggregation. Unlike the opaque-payload
 * transports (Event Hubs, Service Bus, Kafka), the Cosmos DB trigger delivers already-deserialized
 * documents, so the pipeline is generic over the document type rather than fanning out routable message
 * envelopes.
 *
 * Reuses the already-ported streaming primitives (`StreamContext` / `StreamMiddlewareApplication` from
 * `@benzenejs/core-middleware`), exactly as the C# `Benzene.Core.Middleware/Streaming` engine — the Cosmos
 * counterpart to Event Hub's `UseEventHubStream` and AWS's Kinesis. The `CosmosDBTrigger` checkpoints
 * its lease automatically when the invocation returns successfully, so the context's checkpointer is the
 * no-op default; an exception thrown from the pipeline propagates to the runtime, leaving the lease
 * untouched for redelivery of the whole batch.
 *
 * DEFERRED: the C# `UseCosmosDbChangeFeed(this IBenzeneApplicationBuilder, ...)` host-neutral overload is
 * not ported — it depends on the unported `IBenzeneApplicationBuilder` generic-host abstraction (the
 * same deferral as the ported `useServiceBus`/`useEventHub`).
 *
 * @typeParam TDocument The document type the change feed batch is deserialized into.
 * @param app The Azure Function app builder.
 * @param action Configures the stream pipeline (add `useStream(...)` etc.).
 */
export function useCosmosDbChangeFeed<TDocument>(
  app: IAzureFunctionAppBuilder,
  action: PipelineBuilderAction<StreamContext<TDocument>>,
): IAzureFunctionAppBuilder {
  const pipeline = app.create<StreamContext<TDocument>>();
  action(pipeline);
  app.add(
    (serviceResolverFactory: IServiceResolverFactory) =>
      new EntryPointMiddlewareApplication<readonly TDocument[]>(
        new StreamMiddlewareApplication<readonly TDocument[], TDocument>(
          pipeline.build(),
          toStreamContext,
        ),
        serviceResolverFactory,
      ),
  );
  return app;
}

function toStreamContext<TDocument>(
  documents: readonly TDocument[] | null | undefined,
): StreamContext<TDocument> {
  return new StreamContext<TDocument>(toAsyncIterable(documents ?? []));
}

async function* toAsyncIterable<TDocument>(
  documents: readonly TDocument[],
): AsyncGenerator<TDocument> {
  for (const document of documents) {
    yield document;
  }
}

/** Port of Benzene.Azure.Function.CosmosDb.StreamingExtensions. */
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzenejs/abstractions';
import { IMiddlewareApplication, PipelineBuilderAction } from '@benzenejs/abstractions-middleware';
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
  configure?: (options: CosmosDbChangeFeedOptions) => void,
): IAzureFunctionAppBuilder {
  const pipeline = app.create<StreamContext<TDocument>>();
  action(pipeline);
  const options = new CosmosDbChangeFeedOptions();
  configure?.(options);
  app.add((serviceResolverFactory: IServiceResolverFactory) => {
    const stream = new StreamMiddlewareApplication<readonly TDocument[], TDocument>(pipeline.build(), toStreamContext);
    return new EntryPointMiddlewareApplication<readonly TDocument[]>(
      options.atMostOnce ? new AtMostOnceChangeFeedApplication(stream) : stream,
      serviceResolverFactory,
    );
  });
  return app;
}

/**
 * Settlement for the Functions Cosmos DB change-feed trigger (transport-bindings §1, obligation 8) — the
 * `cosmosdb-changefeed` **stream** binding. It is fan-in (the delivered batch is one `StreamContext`, with
 * no routing and so no per-document result); the unit of settlement is the **batch (lease)**: an uncaught
 * error fails the invocation, the lease is not checkpointed, and the batch is redelivered.
 *
 * TypeScript-only type (the .NET trigger has no options yet).
 */
export class CosmosDbChangeFeedOptions {
  /**
   * The **at-most-once override**: catch and log an uncaught error so the invocation succeeds and the
   * lease checkpoints past the batch (skip-and-continue). Defaults to `false`.
   */
  atMostOnce = false;
}

class AtMostOnceChangeFeedApplication<TDocument> implements IMiddlewareApplication<readonly TDocument[]> {
  constructor(private readonly inner: IMiddlewareApplication<readonly TDocument[]>) {}

  async handleAsync(documents: readonly TDocument[], serviceResolverFactory: IServiceResolverFactory): Promise<void> {
    try {
      await this.inner.handleAsync(documents, serviceResolverFactory);
    } catch (ex) {
      const loggingScope = serviceResolverFactory.createScope();
      try {
        const logger =
          loggingScope.tryGetService(ILoggerFactory)?.createLogger('CosmosDbChangeFeed') ?? NullLogger.instance;
        logger.logError(ex, 'Processing the change-feed batch failed; checkpointed past it (atMostOnce)');
      } finally {
        loggingScope.dispose();
      }
    }
  }
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

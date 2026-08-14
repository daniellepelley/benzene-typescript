/**
 * Port of Benzene.Azure.CosmosDb.Extensions (C# fluent extension methods -> free functions taking the
 * worker startup / service container as their first argument).
 *
 * Adds a standalone Cosmos DB Change Feed consumer to a Benzene worker. Unlike
 * `@benzenejs/azure-function-cosmos-db`, which processes batches delivered via an Azure Functions
 * `CosmosDBTrigger`, this package consumes the change feed directly using
 * {@link BenzeneCosmosChangeFeedWorker} — intended for long-running workers (e.g. `@benzenejs/self-host`)
 * rather than Azure Functions, and for handlers that want manual per-batch checkpoint control.
 */
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { PipelineBuilderAction } from '@benzenejs/abstractions-middleware';
import { ITransportInfo, TransportNames } from '@benzenejs/abstractions-message-handlers';
import { TransportInfo } from '@benzenejs/core-message-handlers';
import { StreamContext } from '@benzenejs/core-middleware';
import { IBenzeneWorkerStartup } from '@benzenejs/self-host';
import { BenzeneCosmosAllVersionsChangeFeedConfig } from './BenzeneCosmosAllVersionsChangeFeedConfig';
import { BenzeneCosmosAllVersionsChangeFeedWorker } from './BenzeneCosmosAllVersionsChangeFeedWorker';
import { BenzeneCosmosChangeFeedConfig } from './BenzeneCosmosChangeFeedConfig';
import { BenzeneCosmosChangeFeedWorker } from './BenzeneCosmosChangeFeedWorker';
import { CosmosAllVersionsChangeFeedApplication } from './CosmosAllVersionsChangeFeedApplication';
import { CosmosChangeFeedApplication } from './CosmosChangeFeedApplication';
import { CosmosChangeFeedItem } from './CosmosChangeFeedItem';
import { ICosmosChangeFeedProcessorFactory } from './ICosmosChangeFeedProcessorFactory';

/**
 * Registers the services Cosmos DB Change Feed consumption depends on beyond the entry point
 * application itself — currently just the {@link ITransportInfo} advertising `"cosmos-db"` as a wired
 * transport. Called automatically by {@link useCosmosDbChangeFeed} /
 * {@link useCosmosDbAllVersionsChangeFeed}.
 *
 * @param services The service container to register services with.
 * @returns The service container, for chaining.
 */
export function addCosmosDbChangeFeed(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  services.addSingletonFactory(ITransportInfo, () => new TransportInfo(TransportNames.CosmosDb));
  return services;
}

/**
 * Adds a Cosmos DB Change Feed consumer to the worker. There is no `useMessageHandlers()`-style routing
 * on this transport — changed documents carry no message envelope — so the pipeline is a streaming
 * pipeline over the document type, mirroring the Functions trigger adapter's `useCosmosDbChangeFeed`.
 *
 * @typeParam TDocument The document type the change feed batches are deserialized into.
 * @param app The worker startup to add the change feed consumer to.
 * @param config The checkpointing and failure-handling behaviour to use.
 * @param processorFactory The factory used to create the underlying processor (which decides the
 * monitored container, checkpoint store, and authentication).
 * @param action Configures the stream pipeline (add `useStream(...)` etc.).
 * @returns The worker startup, for chaining.
 */
export function useCosmosDbChangeFeed<TDocument>(
  app: IBenzeneWorkerStartup,
  config: BenzeneCosmosChangeFeedConfig,
  processorFactory: ICosmosChangeFeedProcessorFactory<TDocument>,
  action: PipelineBuilderAction<StreamContext<TDocument>>,
): IBenzeneWorkerStartup {
  app.register((x) => addCosmosDbChangeFeed(x));
  const middlewarePipelineBuilder = app.create<StreamContext<TDocument>>();
  action(middlewarePipelineBuilder);
  const pipeline = middlewarePipelineBuilder.build();

  const application = new CosmosChangeFeedApplication<TDocument>(pipeline);
  app.add(
    (serviceResolverFactory) =>
      new BenzeneCosmosChangeFeedWorker<TDocument>(
        serviceResolverFactory,
        application,
        config,
        processorFactory,
      ),
  );
  return app;
}

/**
 * Adds a Cosmos DB Change Feed consumer in *all-versions-and-deletes* mode: the pipeline is a streaming
 * pipeline over {@link CosmosChangeFeedItem} (current + previous + change type), so deletes and
 * intermediate versions surface (requires caller-configured container/account retention). Because the
 * all-versions path is automatic-checkpoint only, there is no per-batch checkpointer — progress
 * advances when the handler returns without throwing; the only failure knob is
 * {@link BenzeneCosmosAllVersionsChangeFeedConfig.catchHandlerExceptions}.
 *
 * @typeParam TDocument The document type the change items are deserialized into.
 * @param app The worker startup to add the change feed consumer to.
 * @param config The failure-handling behaviour to use.
 * @param processorFactory The factory used to create the underlying all-versions processor; must
 * support `createAllVersionsAndDeletes` (the built-in `CosmosChangeFeedProcessorFactory` does).
 * @param action Configures the stream pipeline (add `useStream(...)` etc.).
 * @returns The worker startup, for chaining.
 */
export function useCosmosDbAllVersionsChangeFeed<TDocument>(
  app: IBenzeneWorkerStartup,
  config: BenzeneCosmosAllVersionsChangeFeedConfig,
  processorFactory: ICosmosChangeFeedProcessorFactory<TDocument>,
  action: PipelineBuilderAction<StreamContext<CosmosChangeFeedItem<TDocument>>>,
): IBenzeneWorkerStartup {
  app.register((x) => addCosmosDbChangeFeed(x));
  const middlewarePipelineBuilder = app.create<StreamContext<CosmosChangeFeedItem<TDocument>>>();
  action(middlewarePipelineBuilder);
  const pipeline = middlewarePipelineBuilder.build();

  const application = new CosmosAllVersionsChangeFeedApplication<TDocument>(pipeline);
  app.add(
    (serviceResolverFactory) =>
      new BenzeneCosmosAllVersionsChangeFeedWorker<TDocument>(
        serviceResolverFactory,
        application,
        config,
        processorFactory,
      ),
  );
  return app;
}

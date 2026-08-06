/**
 * Port of Benzene.Azure.CosmosDb — the standalone (non-Functions) Cosmos DB change-feed consumer
 * worker (barrel).
 *
 * `useCosmosDbChangeFeed(workerStartup, config, processorFactory, action)` adds a long-running
 * {@link BenzeneCosmosChangeFeedWorker} that consumes a container's change feed and runs each delivered
 * batch through a Benzene *streaming* pipeline (fan-in: the whole batch as one
 * `StreamContext<TDocument>`, transport `"cosmos-db"`), with manual per-batch checkpoint control on top
 * of the Functions trigger's checkpoint-on-success. `useCosmosDbAllVersionsChangeFeed(...)` is the
 * all-versions-and-deletes sibling, streaming {@link CosmosChangeFeedItem} (current + previous +
 * {@link CosmosChangeType}) so deletes and intermediate versions surface. Intended for
 * `@benzene/self-host` workers rather than Azure Functions (for a `CosmosDBTrigger`, use
 * `@benzene/azure-function-cosmos-db`).
 *
 * THE CHANGE-FEED-PROCESSOR FORK. The .NET `Microsoft.Azure.Cosmos` SDK has a **push-model**
 * `ChangeFeedProcessor` with automatic lease/checkpoint management. `@azure/cosmos` has **no** such
 * processor — only a **pull-model** change-feed iterator (`container.items.getChangeFeedIterator(...)`
 * with `ChangeFeedStartFrom`/`ChangeFeedMode` and continuation tokens). So the SDK's processor, its
 * context, its `Container.ChangeFeed*` delegates and `ChangeFeedItem<T>` are all declared by this
 * package (see {@link ChangeFeedProcessor}), and {@link CosmosChangeFeedProcessorFactory} realizes the
 * "processor" by driving that pull iterator in a poll loop, persisting the continuation token (through
 * a caller-supplied {@link ICosmosChangeFeedCheckpointStore}) as the checkpoint. The Benzene-facing
 * surface — `CosmosChangeType`, the change-feed item/batch shapes, the config/worker/application/DI
 * types — is a faithful port; the deviations the pull model forces are recorded in the README
 * "Porting conventions" table.
 */
export * from './CosmosChangeType';
export * from './CosmosChangeFeedItem';
export * from './CosmosChangeFeedBatch';
export * from './CosmosAllVersionsChangeFeedBatch';
export * from './BenzeneCosmosChangeFeedConfig';
export * from './BenzeneCosmosAllVersionsChangeFeedConfig';
export * from './CosmosChangeFeedStreamCheckpointer';
export * from './ChangeFeedProcessor';
export * from './ICosmosChangeFeedProcessorFactory';
export * from './CosmosChangeFeedProcessorFactory';
export * from './CosmosChangeFeedApplication';
export * from './CosmosAllVersionsChangeFeedApplication';
export * from './BenzeneCosmosChangeFeedWorker';
export * from './BenzeneCosmosAllVersionsChangeFeedWorker';
export * from './Extensions';

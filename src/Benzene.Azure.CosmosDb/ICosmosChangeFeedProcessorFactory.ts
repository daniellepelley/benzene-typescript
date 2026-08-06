/** Port of Benzene.Azure.CosmosDb.ICosmosChangeFeedProcessorFactory. */
import {
  ChangeFeedHandler,
  ChangeFeedHandlerWithManualCheckpoint,
  ChangeFeedItem,
  ChangeFeedMonitorErrorDelegate,
  ChangeFeedProcessor,
} from './ChangeFeedProcessor';

/**
 * Creates the underlying {@link ChangeFeedProcessor} used by {@link BenzeneCosmosChangeFeedWorker} to
 * consume a container's change feed. Lets the caller decide the monitored container, the
 * continuation-token checkpoint store, poll interval, batch size, start time, and authentication
 * (connection string, Managed Identity via a `TokenCredential`, emulator, ...) without the worker
 * prescribing any of it. Like the .NET SDK's builder — and unlike Event Hubs' `EventProcessorClient` —
 * the change handler is required at build time, so the worker passes its delegates in rather than
 * attaching them afterwards.
 *
 * PORTING NOTE: {@link CreateAllVersionsAndDeletes} is a C# default-interface method that throws. A TS
 * interface can't carry a method body, so the default lives as an exported free function
 * {@link createAllVersionsAndDeletesNotSupported} that an implementation can delegate to — the built-in
 * {@link CosmosChangeFeedProcessorFactory} implements the method for real.
 *
 * @typeParam TDocument The document type the change feed batches are deserialized into.
 */
export interface ICosmosChangeFeedProcessorFactory<TDocument> {
  /**
   * Creates a {@link ChangeFeedProcessor} that delivers change batches to `onChanges` (with manual
   * checkpoint control) and errors to `onError`.
   *
   * @param onChanges The worker's batch handler, including its manual checkpoint hook.
   * @param onError The worker's error handler for lease/processing failures.
   * @returns The created (not yet started) processor.
   */
  create(
    onChanges: ChangeFeedHandlerWithManualCheckpoint<TDocument>,
    onError: ChangeFeedMonitorErrorDelegate,
  ): ChangeFeedProcessor;

  /**
   * Creates a {@link ChangeFeedProcessor} in *all-versions-and-deletes* mode, delivering each change
   * (current + previous + operation type) as a {@link ChangeFeedItem} to `onChanges`. This mode is
   * *automatic-checkpoint only* — so, unlike {@link create}, there is no checkpoint hook: the processor
   * checkpoints after the handler returns successfully. Requires the caller to have configured
   * container/account retention (otherwise deletes/intermediate versions don't surface). A custom
   * factory that doesn't support this mode should delegate to
   * {@link createAllVersionsAndDeletesNotSupported}; the built-in {@link CosmosChangeFeedProcessorFactory}
   * implements it.
   *
   * @param onChanges The worker's batch handler over {@link ChangeFeedItem} changes.
   * @param onError The worker's error handler for lease/processing failures.
   * @returns The created (not yet started) processor.
   */
  createAllVersionsAndDeletes(
    onChanges: ChangeFeedHandler<ChangeFeedItem<TDocument>>,
    onError: ChangeFeedMonitorErrorDelegate,
  ): ChangeFeedProcessor;
}

/**
 * The stand-in for the C# default-interface implementation of `CreateAllVersionsAndDeletes`: throws to
 * signal a factory that doesn't support all-versions-and-deletes mode.
 */
export function createAllVersionsAndDeletesNotSupported(): never {
  throw new Error(
    'This ICosmosChangeFeedProcessorFactory implementation does not support all-versions-and-deletes mode. ' +
      'Use the built-in CosmosChangeFeedProcessorFactory or implement createAllVersionsAndDeletes.',
  );
}

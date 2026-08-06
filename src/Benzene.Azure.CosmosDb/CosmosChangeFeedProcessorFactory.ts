/** Port of Benzene.Azure.CosmosDb.CosmosChangeFeedProcessorFactory. */
import {
  ChangeFeedIteratorOptions,
  ChangeFeedMode,
  ChangeFeedPullModelIterator,
  ChangeFeedStartFrom,
  StatusCodes,
} from '@azure/cosmos';
import {
  ChangeFeedHandler,
  ChangeFeedHandlerWithManualCheckpoint,
  ChangeFeedItem,
  ChangeFeedMonitorErrorDelegate,
  ChangeFeedProcessor,
  ChangeFeedProcessorContext,
  ICosmosChangeFeedCheckpointStore,
} from './ChangeFeedProcessor';
import { ICosmosChangeFeedProcessorFactory } from './ICosmosChangeFeedProcessorFactory';

/**
 * The minimal `Container` surface the factory drives — the pull-model change-feed iterator entry
 * point. `@azure/cosmos`'s real `Container` structurally satisfies this, so a caller passes their
 * `container` directly; a test can fake it without constructing the whole SDK type.
 */
export interface CosmosChangeFeedSource {
  readonly items: {
    getChangeFeedIterator<T>(options?: ChangeFeedIteratorOptions): ChangeFeedPullModelIterator<T>;
  };
}

/** Tuning for {@link CosmosChangeFeedProcessorFactory}'s poll loop. */
export interface CosmosChangeFeedProcessorOptions {
  /**
   * A logical name for the checkpoint this processor owns — the key the continuation token is
   * persisted under and the {@link ChangeFeedProcessorContext.leaseToken} surfaced to the pipeline.
   * Defaults to `"0"`.
   */
  leaseToken?: string;
  /** Max items per change-feed page (the iterator's `maxItemCount`). */
  maxItemCount?: number;
  /** Delay between polls when the feed reports no new changes (304 Not Modified). Defaults to 5000ms. */
  pollIntervalMs?: number;
  /**
   * Where to start when no continuation token has been persisted yet. Defaults to
   * `ChangeFeedStartFrom.Now()` — mirroring a fresh Change Feed Processor reading changes from "now".
   */
  startFrom?: ChangeFeedStartFrom;
}

const DEFAULT_LEASE_TOKEN = '0';
const DEFAULT_POLL_INTERVAL_MS = 5000;

/**
 * Default {@link ICosmosChangeFeedProcessorFactory}: realizes the (non-existent-in-JS) push-model
 * Change Feed Processor by driving `@azure/cosmos`'s **pull-model** change-feed iterator
 * (`container.items.getChangeFeedIterator(...)`) in a poll loop, persisting the change feed's
 * continuation token through the caller-supplied {@link ICosmosChangeFeedCheckpointStore} as the
 * checkpoint. See the README "Porting conventions" change-feed-processor fork note.
 *
 * DEVIATION FROM THE .NET FACTORY. The .NET `CosmosChangeFeedProcessorFactory` takes a monitored
 * container, a *lease container*, a processor name, and an instance name — the lease container +
 * names drive the SDK's automatic lease ownership + cross-instance load balancing. The JS pull
 * iterator has none of that machinery, so this port instead takes a monitored container and a
 * continuation-token checkpoint store: it is a single-consumer poll loop over the whole container's
 * feed (no lease-based load balancing across instances — the subsystem the SDK doesn't provide). What
 * survives faithfully: the caller owns the container + authentication, the worker gets a
 * checkpoint hook (persist the continuation token), and progress advances in-memory even when a batch
 * isn't durably checkpointed (a restart resumes from the last persisted token — at-least-once).
 *
 * @typeParam TDocument The document type the change feed batches are deserialized into.
 */
export class CosmosChangeFeedProcessorFactory<TDocument>
  implements ICosmosChangeFeedProcessorFactory<TDocument>
{
  private readonly leaseToken: string;
  private readonly pollIntervalMs: number;

  /**
   * @param monitoredContainer The container whose change feed is consumed.
   * @param checkpointStore Where the continuation-token checkpoint is persisted/resumed.
   * @param options Optional poll-loop tuning (lease token, batch size, poll interval, start point).
   */
  constructor(
    private readonly monitoredContainer: CosmosChangeFeedSource,
    private readonly checkpointStore: ICosmosChangeFeedCheckpointStore,
    private readonly options: CosmosChangeFeedProcessorOptions = {},
  ) {
    this.leaseToken = options.leaseToken ?? DEFAULT_LEASE_TOKEN;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  /** {@inheritDoc ICosmosChangeFeedProcessorFactory.create} */
  create(
    onChanges: ChangeFeedHandlerWithManualCheckpoint<TDocument>,
    onError: ChangeFeedMonitorErrorDelegate,
  ): ChangeFeedProcessor {
    return this.createProcessor<TDocument>(
      ChangeFeedMode.LatestVersion,
      // Manual-checkpoint path: hand the worker the persist hook; it decides when to call it.
      (context, page, persist, signal) => onChanges(context, page, persist, signal),
      onError,
    );
  }

  /** {@inheritDoc ICosmosChangeFeedProcessorFactory.createAllVersionsAndDeletes} */
  createAllVersionsAndDeletes(
    onChanges: ChangeFeedHandler<ChangeFeedItem<TDocument>>,
    onError: ChangeFeedMonitorErrorDelegate,
  ): ChangeFeedProcessor {
    return this.createProcessor<ChangeFeedItem<TDocument>>(
      ChangeFeedMode.AllVersionsAndDeletes,
      // Automatic-checkpoint path: no hook to the handler; persist after it returns successfully.
      async (context, page, persist, signal) => {
        await onChanges(context, page, signal);
        await persist();
      },
      onError,
    );
  }

  private createProcessor<TPageItem>(
    mode: ChangeFeedMode,
    dispatch: (
      context: ChangeFeedProcessorContext,
      page: readonly TPageItem[],
      persist: () => Promise<void>,
      signal: AbortSignal | undefined,
    ) => Promise<void>,
    onError: ChangeFeedMonitorErrorDelegate,
  ): ChangeFeedProcessor {
    const controller = new AbortController();
    let loopPromise: Promise<void> | undefined;

    const run = async (): Promise<void> => {
      const signal = controller.signal;
      const context: ChangeFeedProcessorContext = { leaseToken: this.leaseToken };

      // The last durably-persisted continuation token — where a restart (or an in-process
      // redelivery after a handler throws) resumes from.
      let checkpointed = await this.checkpointStore.readContinuationToken(this.leaseToken);
      let iterator = this.getIterator<TPageItem>(mode, checkpointed);

      while (!signal.aborted) {
        let response: Awaited<ReturnType<ChangeFeedPullModelIterator<TPageItem>['readNext']>>;
        try {
          response = await iterator.readNext();
        } catch (error) {
          await onError(this.leaseToken, error);
          await this.delay(this.pollIntervalMs, signal);
          continue;
        }

        if (response.statusCode === StatusCodes.NotModified || response.count === 0) {
          // No new changes — wait, then poll again (the iterator holds its own position in-memory).
          await this.delay(this.pollIntervalMs, signal);
          continue;
        }

        const continuationToken = response.continuationToken;
        const persist = async (): Promise<void> => {
          checkpointed = continuationToken;
          await this.checkpointStore.writeContinuationToken(this.leaseToken, continuationToken);
        };

        try {
          await dispatch(context, response.result, persist, signal);
        } catch (error) {
          await onError(this.leaseToken, error);
          // The handler rejected: rewind to the last durable checkpoint so the same batch is
          // redelivered (at-least-once), matching the .NET processor not advancing its lease.
          iterator = this.getIterator<TPageItem>(mode, checkpointed);
          await this.delay(this.pollIntervalMs, signal);
        }
      }
    };

    return {
      startAsync: (): Promise<void> => {
        loopPromise = run();
        return Promise.resolve();
      },
      stopAsync: async (): Promise<void> => {
        controller.abort();
        if (loopPromise !== undefined) {
          await loopPromise;
          loopPromise = undefined;
        }
      },
    };
  }

  private getIterator<T>(
    mode: ChangeFeedMode,
    continuationToken: string | undefined,
  ): ChangeFeedPullModelIterator<T> {
    const iteratorOptions: ChangeFeedIteratorOptions = {
      changeFeedMode: mode,
      changeFeedStartFrom:
        continuationToken !== undefined
          ? ChangeFeedStartFrom.Continuation(continuationToken)
          : (this.options.startFrom ?? ChangeFeedStartFrom.Now()),
    };
    if (this.options.maxItemCount !== undefined) {
      iteratorOptions.maxItemCount = this.options.maxItemCount;
    }
    return this.monitoredContainer.items.getChangeFeedIterator<T>(iteratorOptions);
  }

  /** A signal-interruptible delay so a polling loop unblocks immediately on `stopAsync`. */
  private delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

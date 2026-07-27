/** Port of Benzene.Azure.EventHub.BenzeneEventHubWorker. */
import {
  EventHubConsumerClient,
  PartitionContext,
  ReceivedEventData,
  SubscribeOptions,
  Subscription,
} from '@azure/event-hubs';
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzene/abstractions';
import { IBenzeneWorker } from '@benzene/abstractions-middleware';
import { BenzeneEventHubConfig, withEventHubConfigDefaults } from './BenzeneEventHubConfig';
import { EventHubConsumerApplication } from './EventHubConsumerApplication';
import { EventHubMessageProcessingException } from './EventHubMessageProcessingException';
import { IEventProcessorClientFactory } from './IEventProcessorClientFactory';

/**
 * A long-running worker that consumes an Event Hub and dispatches each event through the middleware
 * pipeline — for `@benzene/self-host`, not Azure Functions (use `@benzene/azure-function-event-hub` for
 * an Event Hub trigger).
 *
 * PORTING NOTE — the SDK's processor model. .NET uses `EventProcessorClient` (`ProcessEventAsync`/
 * `ProcessErrorAsync`/`PartitionInitializingAsync` events, `StartProcessingAsync`/`StopProcessingAsync`).
 * `@azure/event-hubs` has no `EventProcessorClient`; the equivalent is an `EventHubConsumerClient`
 * (built with a `CheckpointStore` by the caller's factory) whose `subscribe({ processEvents, processError
 * }, { startPosition })` provides automatic partition load-balancing, per-partition sequential dispatch,
 * and checkpointing via the `PartitionContext.updateCheckpoint(event)` passed to `processEvents`.
 * `startAsync` subscribes and returns (correct `IHostedService` semantics); `stopAsync` closes the
 * subscription (draining in-flight handlers). The consumer client's lifecycle is the caller's (matching
 * .NET, whose `StopAsync` stops processing but does not dispose the processor).
 *
 * `processEvents` delivers a *batch* per call (unlike .NET's per-event `ProcessEventAsync`), but the SDK
 * still calls it sequentially per partition, so the batch is processed in order and the per-partition
 * checkpoint counter has no same-partition race (`Map` only for cross-partition access) — exactly the
 * .NET invariant.
 */
export class BenzeneEventHubWorker implements IBenzeneWorker {
  private readonly config: BenzeneEventHubConfig;
  private readonly uncheckpointedCounts = new Map<string, number>();
  private client: EventHubConsumerClient | undefined;
  private subscription: Subscription | undefined;
  private stopInitiated = false;

  constructor(
    private readonly serviceResolverFactory: IServiceResolverFactory,
    private readonly application: EventHubConsumerApplication,
    config: BenzeneEventHubConfig,
    private readonly clientFactory: IEventProcessorClientFactory,
  ) {
    this.config = withEventHubConfigDefaults(config);
  }

  /**
   * Creates the client and subscribes. Returns once running — it does not block until shutdown. Use
   * `stopAsync` to stop consuming and wait for in-flight handlers to finish.
   */
  async startAsync(_cancellationToken?: AbortSignal): Promise<void> {
    this.client = this.clientFactory.create();

    const options: SubscribeOptions = {};
    if (this.config.defaultStartingPosition !== undefined) {
      // The subscribe `startPosition` is the fallback for partitions with no stored checkpoint — the
      // same role as .NET's PartitionInitializingAsync.DefaultStartingPosition. A checkpointed
      // partition resumes from its checkpoint regardless.
      options.startPosition = this.config.defaultStartingPosition;
    }

    this.subscription = this.client.subscribe(
      {
        processEvents: (events, context) => this.onProcessEventsAsync(events, context),
        processError: (error, context) => this.onProcessErrorAsync(error, context),
      },
      options,
    );

    return Promise.resolve();
  }

  /** Stops consuming — closing the subscription, which waits for in-flight handlers to finish. */
  async stopAsync(_cancellationToken?: AbortSignal): Promise<void> {
    if (this.subscription !== undefined) {
      await this.subscription.close();
      this.subscription = undefined;
    }
  }

  private async onProcessEventsAsync(
    events: ReceivedEventData[],
    context: PartitionContext,
  ): Promise<void> {
    for (const event of events) {
      try {
        const messageResult = await this.application.handleAsync(event, this.serviceResolverFactory);

        if (this.config.raiseOnFailureStatus && messageResult?.isSuccessful === false) {
          // Escalate a non-exception failure result into the same path as a thrown exception: don't
          // checkpoint past this event, and (if catchHandlerExceptions is off) stop the worker so a
          // restart reprocesses from the last checkpoint.
          throw new EventHubMessageProcessingException(event.sequenceNumber, context.partitionId);
        }
      } catch (error) {
        const loggingScope = this.serviceResolverFactory.createScope();
        try {
          const logger =
            loggingScope.tryGetService(ILoggerFactory)?.createLogger('BenzeneEventHubWorker') ??
            NullLogger.instance;
          logger.logError(
            error,
            `Processing event with sequence number ${event.sequenceNumber} on partition ${context.partitionId} failed`,
          );
        } finally {
          if (loggingScope.disposeAsync) {
            await loggingScope.disposeAsync();
          } else {
            loggingScope.dispose();
          }
        }

        if (!this.config.catchHandlerExceptions) {
          // At-least-once: stop the worker without checkpointing the failed event, so a restart
          // resumes from the last checkpoint and redelivers it. Deferred (not awaited) so closing the
          // subscription doesn't deadlock waiting for this very handler to return; guarded so a
          // concurrent host stopAsync is safe.
          this.initiateStop();
          return;
        }

        // catchHandlerExceptions (default): skip this event (not checkpointed) and keep going — a
        // later event checkpoints past it. The failed event does not count toward the interval.
        continue;
      }

      // One event at a time per partition, so this count has no same-partition race.
      const seen = (this.uncheckpointedCounts.get(context.partitionId) ?? 0) + 1;
      if (seen >= this.config.checkpointInterval!) {
        await context.updateCheckpoint(event);
        this.uncheckpointedCounts.set(context.partitionId, 0);
      } else {
        this.uncheckpointedCounts.set(context.partitionId, seen);
      }
    }
  }

  private initiateStop(): void {
    if (this.stopInitiated) {
      return;
    }
    this.stopInitiated = true;
    const subscription = this.subscription;
    // Defer so close() starts after this handler returns rather than from inside it.
    queueMicrotask(() => {
      void subscription?.close();
    });
  }

  private onProcessErrorAsync(error: Error, context: PartitionContext): Promise<void> {
    const loggingScope = this.serviceResolverFactory.createScope();
    try {
      const logger =
        loggingScope.tryGetService(ILoggerFactory)?.createLogger('BenzeneEventHubWorker') ??
        NullLogger.instance;
      logger.logError(error, `Event Hub processing failed on partition ${context.partitionId}`);
    } finally {
      loggingScope.dispose();
    }
    return Promise.resolve();
  }
}

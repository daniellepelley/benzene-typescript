/** Port of Benzene.Azure.EventHub.BenzeneEventHubConfig. */
import { EventPosition } from '@azure/event-hubs';
import { SettlementOptions } from '@benzenejs/core-message-handlers';
import { EventHubConsumerMessageTopicGetter } from './EventHubConsumerMessageTopicGetter';

/**
 * Configures the processing behaviour used by {@link BenzeneEventHubWorker}. Which hub, consumer group,
 * and checkpoint store to use are decided by the `EventHubConsumerClient` the caller builds (see
 * {@link IEventProcessorClientFactory}) — this config only covers what Benzene itself decides.
 *
 * Settlement (transport-bindings §1, obligation 8) — a **stream** binding whose unit of settlement is
 * the **partition checkpoint**. By default it skips-and-continues (as .NET does): a failed event (failure
 * result or exception) is logged and not checkpointed, and a later event checkpoints past it; a missing
 * result and an unmatched topic are acknowledged. `catchHandlerExceptions: false` makes it at-least-once
 * (stop without checkpointing); `atMostOnce` checkpoints every event whatever the outcome.
 *
 * PORTING NOTE: the C# class (get/set properties with defaults) becomes an interface with optional
 * members; {@link withEventHubConfigDefaults} applies the same defaults the C# property initializers do.
 */
export interface BenzeneEventHubConfig extends Partial<SettlementOptions> {
  /**
   * Where a partition starts reading when it has *no stored checkpoint* yet. `undefined` (the default)
   * leaves the SDK's own default (`latestEventPosition` — only events enqueued after the processor
   * claims the partition). Set to `earliestEventPosition` to process the full retained backlog on first
   * run. Once a partition has a checkpoint, that checkpoint always wins and this is ignored. Mapped to
   * the `subscribe` option `startPosition`. Kafka equivalent: `ConsumerConfig.AutoOffsetReset`.
   */
  defaultStartingPosition?: EventPosition;
  /**
   * How many successfully handled events a partition accumulates before its checkpoint is updated.
   * Defaults to 1 — checkpoint after every event. Raise for throughput at the cost of a larger replay
   * window (up to `checkpointInterval - 1` already-handled events can be redelivered on restart).
   */
  checkpointInterval?: number;
  /**
   * Whether an unhandled exception from an event's handler is caught (logged, the partition keeps
   * processing, and the failed event is effectively skipped once a later event checkpoints past it).
   * Defaults to `true`. Set `false` to instead stop the whole worker on the first unhandled handler
   * exception, without checkpointing the failed event (at-least-once).
   */
  catchHandlerExceptions?: boolean;
  /**
   * The event property the topic is read from. Defaults to
   * {@link EventHubConsumerMessageTopicGetter.DefaultTopicProperty} (`"topic"`). Keep it in sync with
   * the producer's key.
   */
  topicPropertyKey?: string;
  /**
   * Whether a handler that returns a non-exception failure result is escalated into a thrown
   * {@link EventHubMessageProcessingException} so it's treated exactly like an unhandled exception (the
   * failed event is not checkpointed). Defaults to `true` (at-least-once — don't checkpoint, reprocess
   * from here; the handler must be idempotent). Set `false` for at-most-once (recorded for diagnostics
   * only, checkpoints past it).
   */
  raiseOnFailureStatus?: boolean;
}

/** Fills in the C# property-initializer defaults for the fields the worker reads. */
export function withEventHubConfigDefaults(
  config: BenzeneEventHubConfig,
): BenzeneEventHubConfig &
  Required<
    Pick<
      BenzeneEventHubConfig,
      | 'checkpointInterval'
      | 'catchHandlerExceptions'
      | 'topicPropertyKey'
      | 'raiseOnFailureStatus'
      | 'atMostOnce'
      | 'ignoreUnmatchedTopics'
    >
  > {
  return {
    ...config,
    checkpointInterval: config.checkpointInterval ?? 1,
    catchHandlerExceptions: config.catchHandlerExceptions ?? true,
    topicPropertyKey:
      config.topicPropertyKey ?? EventHubConsumerMessageTopicGetter.DefaultTopicProperty,
    raiseOnFailureStatus: config.raiseOnFailureStatus ?? true,
    atMostOnce: config.atMostOnce ?? false,
    // A stream binding may skip-and-continue (spec); in .NET an unrouted event is a missing result, acked.
    ignoreUnmatchedTopics: config.ignoreUnmatchedTopics ?? true,
  };
}

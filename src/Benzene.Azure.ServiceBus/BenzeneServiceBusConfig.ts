/** Port of Benzene.Azure.ServiceBus.BenzeneServiceBusConfig. */
import { ServiceBusConsumerAckMode } from './ServiceBusConsumerAckMode';
import { ServiceBusConsumerMessageTopicGetter } from './ServiceBusConsumerMessageTopicGetter';

/**
 * Configures the entity and processing behaviour used by {@link BenzeneServiceBusWorker}. Set either
 * {@link queueName} or both {@link topicName} and {@link subscriptionName} — exactly one entity kind,
 * validated at worker startup.
 *
 * PORTING NOTE: the C# class (get/set properties with defaults) becomes an interface with optional
 * members; {@link withServiceBusConfigDefaults} applies the same defaults the C# property initializers do.
 */
export interface BenzeneServiceBusConfig {
  /** The queue to consume from. Mutually exclusive with {@link topicName}/{@link subscriptionName}. */
  queueName?: string;
  /** The topic to consume from. Requires {@link subscriptionName}; mutually exclusive with {@link queueName}. */
  topicName?: string;
  /** The subscription on {@link topicName} to consume from. */
  subscriptionName?: string;
  /**
   * The maximum number of messages handled concurrently (the receiver `subscribe` `maxConcurrentCalls`).
   * Defaults to 5.
   */
  maxConcurrentCalls?: number;
  /**
   * How many additional messages the receiver requests ahead of processing. Defaults to 0 (no prefetch).
   *
   * DIVERGENCE: `@azure/service-bus`'s receiver options expose no `prefetchCount`, so this field is
   * currently accepted for API/config parity with .NET but not plumbed through to the SDK. Left in place
   * so a future SDK version (or a lower-level receiver option) can honour it without a breaking change.
   */
  prefetchCount?: number;
  /**
   * Whether settlement is left to the receiver's auto-complete, or explicitly controlled from the
   * handler's outcome. Defaults to {@link ServiceBusConsumerAckMode.Explicit} — a handler that returns a
   * failure result (not just one that throws) abandons the message for redelivery.
   */
  ackMode?: ServiceBusConsumerAckMode;
  /**
   * The application property the topic is read from. Defaults to
   * {@link ServiceBusConsumerMessageTopicGetter.DefaultTopicProperty} (`"topic"`). Keep it in sync with
   * the producer's key.
   */
  topicPropertyKey?: string;
  /**
   * The maximum total duration (in milliseconds) the receiver renews a message's lock while a handler
   * runs (the receiver's `maxAutoLockRenewalDurationInMs`). `undefined` (the default) leaves the SDK
   * default (5 minutes). Raise it for handlers that can legitimately run longer than the entity's lock
   * duration. C# `TimeSpan?` → millisecond `number`.
   */
  maxAutoLockRenewalDurationInMs?: number;
  /**
   * Whether the entity is session-enabled and should be consumed with per-session FIFO ordering.
   * Defaults to `false`.
   *
   * DIVERGENCE: session consumption is NOT yet supported in the TypeScript port — `@azure/service-bus`
   * has no session *processor* (only one-session-at-a-time `acceptSession`/`acceptNextSession`), so the
   * .NET `ServiceBusSessionProcessor`'s auto-managed concurrent sessions have no direct equivalent. The
   * field (and {@link maxConcurrentSessions}/{@link maxConcurrentCallsPerSession}) is retained for API
   * parity; setting it `true` makes `startAsync` throw a clear error rather than silently ignoring it.
   * A bounded `acceptNextSession` pump is the tracked follow-up (see README roadmap).
   */
  sessionsEnabled?: boolean;
  /** Maximum sessions handled concurrently when {@link sessionsEnabled} (session support deferred). Defaults to 8. */
  maxConcurrentSessions?: number;
  /** Messages of a single session handled concurrently when {@link sessionsEnabled} (deferred). Defaults to 1. */
  maxConcurrentCallsPerSession?: number;
}

/** Fills in the C# property-initializer defaults for the fields the worker reads. */
export function withServiceBusConfigDefaults(
  config: BenzeneServiceBusConfig,
): BenzeneServiceBusConfig &
  Required<
    Pick<
      BenzeneServiceBusConfig,
      | 'maxConcurrentCalls'
      | 'prefetchCount'
      | 'ackMode'
      | 'topicPropertyKey'
      | 'sessionsEnabled'
      | 'maxConcurrentSessions'
      | 'maxConcurrentCallsPerSession'
    >
  > {
  return {
    ...config,
    maxConcurrentCalls: config.maxConcurrentCalls ?? 5,
    prefetchCount: config.prefetchCount ?? 0,
    ackMode: config.ackMode ?? ServiceBusConsumerAckMode.Explicit,
    topicPropertyKey:
      config.topicPropertyKey ?? ServiceBusConsumerMessageTopicGetter.DefaultTopicProperty,
    sessionsEnabled: config.sessionsEnabled ?? false,
    maxConcurrentSessions: config.maxConcurrentSessions ?? 8,
    maxConcurrentCallsPerSession: config.maxConcurrentCallsPerSession ?? 1,
  };
}

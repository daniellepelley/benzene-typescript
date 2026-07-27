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
   * BEND — the bounded session pump. `@azure/service-bus` has no session *processor* (the .NET
   * `ServiceBusSessionProcessor` has no direct equivalent), only the one-session-at-a-time
   * `client.acceptNextSession(entity, options)` primitive. When `true`, {@link BenzeneServiceBusWorker}
   * recreates the session-processor behaviour over that primitive: it runs up to
   * {@link maxConcurrentSessions} concurrent "session slots", each looping accept-a-session →
   * `subscribe` → on drain/error/idle, close and accept the next. Messages are delivered FIFO within a
   * session ({@link maxConcurrentCallsPerSession}, default 1) and settled through the same ack-mode /
   * override logic as the non-session path. The entity must be created session-enabled, and producers
   * must set a session id. See the README "Porting conventions" note and the worker's class doc.
   */
  sessionsEnabled?: boolean;
  /**
   * Maximum sessions handled concurrently when {@link sessionsEnabled} — the number of session-slot
   * pump loops. Defaults to 8.
   */
  maxConcurrentSessions?: number;
  /**
   * Messages of a single session handled concurrently when {@link sessionsEnabled} — the session
   * receiver's `maxConcurrentCalls`. Defaults to 1 (per-session FIFO, the ordering-preserving setting).
   */
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

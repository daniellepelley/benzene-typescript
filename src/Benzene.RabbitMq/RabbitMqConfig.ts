/** Port of Benzene.RabbitMq.RabbitMqConfig. */
import { RabbitMqAckMode } from './RabbitMqAckMode';
import { RabbitMqConstants } from './RabbitMqConstants';

/**
 * The queue to consume and the processing behaviour {@link RabbitMqWorker} uses. The worker assumes the
 * queue (and any dead-letter topology) already exists — declaring exchanges/queues is out of scope here,
 * exactly as the Kafka worker assumes its topics exist.
 *
 * PORTING NOTE: the C# class (get/set properties with defaults) becomes an interface with optional
 * members; {@link withRabbitMqConfigDefaults} applies the same defaults the C# property initializers do.
 * The C# `DrainTimeout` (`TimeSpan`) becomes {@link drainTimeoutMs} (a millisecond `number`).
 */
export interface RabbitMqConfig {
  /** The name of the queue to consume. */
  queueName: string;

  /**
   * The message-property header the topic is read from (falling back to the AMQP routing key when
   * absent). Defaults to {@link RabbitMqConstants.DefaultTopicHeader} (`"topic"`) — set a different key
   * to consume messages a non-Benzene producer routes on another header, without writing a custom topic
   * getter. Keep it in sync with the producer's header key.
   */
  topicHeaderKey?: string;

  /**
   * The consumer prefetch (QoS) count — the maximum number of unacknowledged deliveries the broker will
   * hand this consumer at once. Bounds in-flight work and provides backpressure; set at or above
   * {@link concurrentRequests} so every lane can stay fed. Default 5. Mapped to `channel.prefetch(count)`.
   */
  prefetchCount?: number;

  /**
   * The maximum number of deliveries handled concurrently, across the worker's dispatcher lanes. RabbitMQ
   * makes no ordering promise across a queue once more than one delivery is in flight, so deliveries
   * round-robin across lanes with no per-key affinity. Default 5.
   */
  concurrentRequests?: number;

  /** The settlement mode. Default {@link RabbitMqAckMode.Explicit}. */
  ackMode?: RabbitMqAckMode;

  /**
   * Under {@link RabbitMqAckMode.Explicit}, whether a failed delivery is requeued for another attempt
   * (`true`, the default) or nacked without requeue (`false`) so it is routed to the queue's dead-letter
   * exchange, if one is configured, or dropped otherwise.
   *
   * Requeue is *bounded* to avoid a poison-message hot loop: a delivery that fails on its first attempt
   * is requeued, but a delivery that is *already redelivered* and fails again is nacked without requeue
   * (to the DLX / dropped). RabbitMQ's redelivered flag is a single boolean, not a count, so this is a
   * one-retry bound — for a higher, precise redelivery limit, set {@link requeueOnFailure} to `false` and
   * configure a dead-letter exchange with a queue policy on the broker.
   */
  requeueOnFailure?: boolean;

  /**
   * The maximum time (in milliseconds) `stopAsync` waits for in-flight handlers to finish before
   * abandoning them and closing the channel/connection. Default 30000 (30 seconds). C# `TimeSpan` →
   * millisecond `number`.
   */
  drainTimeoutMs?: number;
}

/** Fills in the C# property-initializer defaults for the fields the worker reads. */
export function withRabbitMqConfigDefaults(
  config: RabbitMqConfig,
): RabbitMqConfig &
  Required<
    Pick<
      RabbitMqConfig,
      'topicHeaderKey' | 'prefetchCount' | 'concurrentRequests' | 'ackMode' | 'requeueOnFailure' | 'drainTimeoutMs'
    >
  > {
  return {
    ...config,
    topicHeaderKey: config.topicHeaderKey ?? RabbitMqConstants.DefaultTopicHeader,
    prefetchCount: config.prefetchCount ?? 5,
    concurrentRequests: config.concurrentRequests ?? 5,
    ackMode: config.ackMode ?? RabbitMqAckMode.Explicit,
    requeueOnFailure: config.requeueOnFailure ?? true,
    drainTimeoutMs: config.drainTimeoutMs ?? 30000,
  };
}

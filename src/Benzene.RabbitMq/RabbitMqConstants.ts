/** Port of Benzene.RabbitMq.RabbitMqConstants. */

/**
 * Shared constants for the RabbitMQ transport.
 */
export const RabbitMqConstants = {
  /**
   * The default AMQP message-property header key a Benzene RabbitMQ producer writes the topic to, and a
   * consumer reads it from. It is a single default, not a hard-coded value: override it per side when
   * integrating with a non-Benzene producer/consumer that carries the topic on a different header — on
   * the consumer via {@link RabbitMqConfig.topicHeaderKey} (or the `addRabbitMqConsumer(topicHeaderKey)`
   * overload / the `RabbitMqMessageTopicGetter` constructor).
   *
   * PORTING NOTE: the producer-side overrides the C# doc mentions (the outbound `UseRabbitMq(...)`
   * extensions / `RabbitMqBenzeneMessageClient` / `RabbitMqContextConverter`) live in the outbound
   * publish slice, which is not ported here — see the README porting-conventions bullet.
   */
  DefaultTopicHeader: 'topic',
} as const;

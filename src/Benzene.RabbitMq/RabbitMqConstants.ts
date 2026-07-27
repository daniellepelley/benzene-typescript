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
   * The producer-side overrides live in the outbound publish slice (`RabbitMqSendMessage/`): the
   * `useRabbitMq(...)` extensions, `RabbitMqBenzeneMessageClient`'s `topicHeaderKey` constructor param,
   * and `RabbitMqContextConverter`'s `topicHeaderKey`.
   */
  DefaultTopicHeader: 'topic',
} as const;

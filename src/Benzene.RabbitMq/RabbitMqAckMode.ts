/** Port of Benzene.RabbitMq.RabbitMqAckMode. */

/**
 * Controls how {@link RabbitMqWorker} settles each delivery with the broker.
 *
 * PORTING NOTE: the C# `enum` becomes a frozen object + union type (the port's convention for closed
 * enums), preserving the underlying numeric values (`Explicit = 0`, `AutoAck = 1`).
 */
export const RabbitMqAckMode = {
  /**
   * The worker acknowledges each delivery from the handler's outcome: `channel.ack` on success,
   * `channel.nack` on a thrown exception or an unsuccessful result. Whether a nacked delivery is
   * requeued or routed to a dead-letter exchange is governed by {@link RabbitMqConfig.requeueOnFailure}.
   * This is the default and the safe choice — a failed message is redelivered or dead-lettered rather
   * than silently lost.
   */
  Explicit: 0,

  /**
   * The broker auto-acknowledges each delivery the moment it is dispatched to the consumer
   * (`noAck: true`), before the handler runs. Lowest overhead, but a handler failure — or a worker crash
   * mid-handling — loses the message with no redelivery. Only for at-most-once, loss-tolerant workloads.
   */
  AutoAck: 1,
} as const;

export type RabbitMqAckMode = (typeof RabbitMqAckMode)[keyof typeof RabbitMqAckMode];

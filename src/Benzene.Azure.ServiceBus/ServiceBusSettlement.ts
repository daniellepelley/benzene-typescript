/** Port of Benzene.Azure.ServiceBus.ServiceBusSettlement. */

/**
 * The explicit settlement a handler can request for a Service Bus message (in
 * {@link ServiceBusConsumerAckMode.Explicit} mode), overriding the default
 * success→complete/failure→abandon behaviour. Set via {@link ServiceBusSettlementHolder}.
 *
 * PORTING NOTE: the C# `enum` becomes a frozen object + union type. C#'s implicit ordinals aren't
 * relied on anywhere (the values are matched by name), so the members are given descriptive string
 * values, which read better in logs/serialization than 0..3.
 */
export const ServiceBusSettlement = {
  /** Complete the message (remove it from the entity). */
  Complete: 'Complete',
  /** Abandon the message so it's redelivered (subject to max-delivery-count). */
  Abandon: 'Abandon',
  /**
   * Move the message to the entity's dead-letter sub-queue with the reason/description from
   * {@link ServiceBusSettlementHolder} — so a poison message is quarantined instead of abandon-looping
   * to max-delivery-count.
   */
  DeadLetter: 'DeadLetter',
  /**
   * Defer the message: it stays in the entity but is only retrievable by sequence number. Receiving
   * deferred messages back is an advanced path the caller owns (track the sequence number yourself);
   * this only defers.
   */
  Defer: 'Defer',
} as const;

export type ServiceBusSettlement = (typeof ServiceBusSettlement)[keyof typeof ServiceBusSettlement];

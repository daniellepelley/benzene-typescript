/** Port of Benzene.Azure.ServiceBus.ServiceBusConsumerAckMode. */

/**
 * Configures how {@link BenzeneServiceBusWorker} settles (completes/abandons) each message after its
 * handler runs.
 *
 * PORTING NOTE: the C# `enum` becomes a frozen object + union type (the port's convention for closed
 * enums), preserving the underlying numeric values (`AutoComplete = 0`, `Explicit = 1`).
 */
export const ServiceBusConsumerAckMode = {
  /**
   * The underlying receiver's own auto-complete behaviour applies: a message is completed once its
   * handler returns without throwing, and abandoned (left for redelivery, subject to the entity's lock
   * duration, max delivery count, and dead-letter settings) when the handler throws. A handler that
   * reports a non-exception failure result still completes in this mode — only a thrown exception
   * triggers abandonment. Opt into this only if a returned failure result should NOT keep the message;
   * the safer {@link ServiceBusConsumerAckMode.Explicit} is the default.
   */
  AutoComplete: 0,
  /**
   * The default. Benzene settles each message itself from the handler's outcome: completed after a
   * successful outcome, abandoned after a failed one — either a thrown exception or a non-exception
   * failure result (`isSuccessful === false`). The worker turns the receiver's auto-complete off itself.
   */
  Explicit: 1,
} as const;

export type ServiceBusConsumerAckMode =
  (typeof ServiceBusConsumerAckMode)[keyof typeof ServiceBusConsumerAckMode];

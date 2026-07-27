/** Port of Benzene.Azure.ServiceBus.ServiceBusSettlementHolder. */
import { ServiceBusSettlement } from './ServiceBusSettlement';

/**
 * Scoped, per-message holder a handler resolves to request an explicit settlement outcome
 * (dead-letter, defer, complete, abandon), overriding the default success→complete/failure→abandon
 * behaviour in {@link ServiceBusConsumerAckMode.Explicit} mode. Follows the "scoped DI state, not
 * context" convention (like `PresetTopicHolder`) so `ServiceBusConsumerContext` stays a pure
 * description of the message. Registered scoped by `addServiceBusConsumer`; a fresh instance per
 * message, default (no override) unless the handler sets it.
 *
 * Only honoured in {@link ServiceBusConsumerAckMode.Explicit} mode — in
 * {@link ServiceBusConsumerAckMode.AutoComplete} the receiver settles the message itself, so an
 * override has no effect.
 */
export class ServiceBusSettlementHolder {
  /** The requested settlement, or `undefined` to use the default outcome-based settlement. */
  override: ServiceBusSettlement | undefined;

  /** The dead-letter reason (a short code), used when {@link override} is `DeadLetter`. Never a secret. */
  deadLetterReason: string | undefined;

  /** The dead-letter description, used when {@link override} is `DeadLetter`. Never a secret. */
  deadLetterDescription: string | undefined;
}

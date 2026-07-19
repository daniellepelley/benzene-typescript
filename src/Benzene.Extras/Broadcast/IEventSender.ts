/** Port of Benzene.Extras.Broadcast.IEventSender. */
import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Sends an outbound event on a topic — the port the broadcast middleware calls to publish a
 * follow-up event after a create/update/delete succeeds. The concrete implementation is transport-
 * specific (e.g. an SNS/EventBridge/Service-Bus publisher) and supplied by the application.
 * Port of Benzene.Extras.Broadcast.IEventSender.
 */
export interface IEventSender {
  /** Port of C# `Task SendAsync<T>(string topic, T payload)`. */
  sendAsync<T>(topic: string, payload: T): Promise<void>;
}

export const IEventSender: ServiceToken<IEventSender> = serviceToken<IEventSender>('IEventSender');

/** Port of Benzene.Clients.Azure.ServiceBus.ServiceBusSendMessageContext. */
import { ServiceBusMessage } from '@azure/service-bus';

/**
 * The middleware pipeline context for sending a single message to Azure Service Bus.
 *
 * MESSAGE-TYPE ADAPTATION: .NET's `Azure.Messaging.ServiceBus.ServiceBusMessage` maps to the same
 * conceptual type from `@azure/service-bus` (an object literal with `body`/`applicationProperties`).
 */
export class ServiceBusSendMessageContext {
  /**
   * Whether the message was sent. Set by `ServiceBusClientMiddleware` once the send completes without
   * throwing — Service Bus `sendMessages` returns no payload, so a completed send is an acknowledgement
   * only.
   */
  isSent = false;

  constructor(readonly message: ServiceBusMessage) {}
}

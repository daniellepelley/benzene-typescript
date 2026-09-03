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

  /**
   * The caller's abort signal for this send, if any — copied from `OutboundContext.signal` by the
   * converter and passed to `sendMessages` as `abortSignal`, so an aborted caller aborts the outbound
   * send instead of running it to completion.
   */
  signal?: AbortSignal;

  constructor(readonly message: ServiceBusMessage) {}
}

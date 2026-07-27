/** Port of Benzene.Clients.Azure.ServiceBus.ServiceBusClientMiddleware. */
import { ServiceBusSender } from '@azure/service-bus';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { ServiceBusSendMessageContext } from './ServiceBusSendMessageContext';

/**
 * Terminal middleware that sends the context's message via a `ServiceBusSender` and records that the
 * send completed. It does not call `next`. Service Bus returns no payload, so success is a completed
 * send. `ServiceBusSender.SendMessageAsync` → `sender.sendMessages(message)`.
 */
export class ServiceBusClientMiddleware implements IMiddleware<ServiceBusSendMessageContext> {
  readonly name = 'ServiceBusClientMiddleware';

  constructor(private readonly sender: ServiceBusSender) {}

  async handleAsync(context: ServiceBusSendMessageContext, _next: NextFunc): Promise<void> {
    await this.sender.sendMessages(context.message);
    context.isSent = true;
  }
}

/** Port of Benzene.Azure.ServiceBus.ServiceBusSettlementDecision. */
import { IMessageResult } from '@benzene/abstractions-message-handlers';
import { ServiceBusSettlementHolder } from './ServiceBusSettlementHolder';

/**
 * The outcome of running a Service Bus message through the pipeline: the handler's recorded result plus
 * any explicit settlement the handler requested via {@link ServiceBusSettlementHolder}. Returned by
 * `ServiceBusConsumerApplication` so `BenzeneServiceBusWorker` can settle the message in
 * `ServiceBusConsumerAckMode.Explicit` mode.
 */
export class ServiceBusSettlementDecision {
  constructor(
    /** The handler's recorded result, or `undefined` if nothing set one. */
    readonly messageResult: IMessageResult | undefined,
    /** The settlement holder the handler may have set an `override` on, or `undefined` if not registered. */
    readonly settlement: ServiceBusSettlementHolder | undefined,
  ) {}
}

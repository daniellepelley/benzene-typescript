/** Port of Benzene.Azure.ServiceBus.ServiceBusConsumerMessageHandlerResultSetter. */
import { MessageMessageHandlerResultSetterBase } from '@benzene/core-message-handlers';
import { ServiceBusConsumerContext } from './ServiceBusConsumerContext';

/**
 * Records a message handler's outcome onto `ServiceBusConsumerContext.messageResult` (via the shared
 * `IHasMessageResult` base). Read (through `ServiceBusConsumerApplication`'s settlement decision) by
 * `BenzeneServiceBusWorker` to support `ServiceBusConsumerAckMode.Explicit` — under `AutoComplete`,
 * settlement is decided by whether the handler threw, regardless of the recorded result.
 *
 * PORTING NOTE: C# subclasses `MessageHandlerResultSetterBase`; the port has a single equivalent base,
 * `MessageMessageHandlerResultSetterBase` (both write the handler's result onto the context's
 * `messageResult`), so this extends it — same as `@benzene/azure-function-service-bus`.
 */
export class ServiceBusConsumerMessageHandlerResultSetter extends MessageMessageHandlerResultSetterBase<ServiceBusConsumerContext> {}

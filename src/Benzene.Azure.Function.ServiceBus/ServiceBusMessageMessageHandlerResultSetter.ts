/** Port of Benzene.Azure.Function.ServiceBus.ServiceBusMessageMessageHandlerResultSetter. */
import { MessageMessageHandlerResultSetterBase } from '@benzene/core-message-handlers';
import { ServiceBusContext } from './ServiceBusContext';

/**
 * Records a message handler's outcome onto `ServiceBusContext.messageResult`. The Service Bus trigger
 * still auto-completes the message per the trigger's default settings regardless of the handler's
 * result (no `ServiceBusMessageActions` wiring — see the C# package's `CLAUDE.md`), but
 * `ServiceBusBatchApplication` reads this to support `ServiceBusOptions.raiseOnFailureStatus`.
 *
 * C# `MessageMessageHandlerResultSetterBase<ServiceBusContext>` (an empty body: `... : Base;`) ports
 * to a trivial subclass of the already-ported `MessageMessageHandlerResultSetterBase`.
 */
export class ServiceBusMessageMessageHandlerResultSetter extends MessageMessageHandlerResultSetterBase<ServiceBusContext> {}

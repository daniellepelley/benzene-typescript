/** Port of Benzene.Azure.EventHub.EventHubConsumerMessageHandlerResultSetter. */
import { MessageMessageHandlerResultSetterBase } from '@benzene/core-message-handlers';
import { EventHubConsumerContext } from './EventHubConsumerContext';

/**
 * Records a message handler's outcome onto `EventHubConsumerContext.messageResult`. Event Hubs has no
 * per-event settlement, so the recorded result only drives the `raiseOnFailureStatus` escalation (and
 * middleware/diagnostics) — see `EventHubConsumerContext.messageResult`.
 *
 * PORTING NOTE: C# subclasses `MessageHandlerResultSetterBase`; the port has a single equivalent base,
 * `MessageMessageHandlerResultSetterBase` (both write the handler's result onto the context).
 */
export class EventHubConsumerMessageHandlerResultSetter extends MessageMessageHandlerResultSetterBase<EventHubConsumerContext> {}
